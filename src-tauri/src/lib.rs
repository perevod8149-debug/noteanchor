use encoding_rs::{UTF_16BE, UTF_16LE, WINDOWS_1252};
use quick_xml::escape::unescape;
use quick_xml::events::Event;
use quick_xml::Reader;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use zip::ZipArchive;

#[tauri::command]
fn ping() -> &'static str {
    "NoteAnchor native bridge is working"
}

fn normalize_document_path(document_path: &str) -> PathBuf {
    if let Some(raw_path) = document_path.strip_prefix("file://") {
        let without_leading_slash = raw_path
            .strip_prefix('/')
            .filter(|path| path.chars().nth(1) == Some(':'))
            .unwrap_or(raw_path);

        return PathBuf::from(without_leading_slash.replace('/', "\\"));
    }

    PathBuf::from(document_path)
}

fn derive_notes_file_path(document_path: &str) -> Result<PathBuf, String> {
    let path = normalize_document_path(document_path);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Unable to derive notes file name.".to_string())?;
    let parent = path.parent().unwrap_or(Path::new(""));

    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("txt"))
        .unwrap_or(false)
    {
        let file_stem = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .ok_or_else(|| "Unable to derive notes file name.".to_string())?;

        Ok(parent.join(format!("{file_stem}.notes.json")))
    } else {
        Ok(parent.join(format!("{file_name}.notes.json")))
    }
}

fn resolve_notes_file_path(
    document_path: &str,
    notes_file_path: Option<&str>,
) -> Result<PathBuf, String> {
    match notes_file_path {
        Some(path) if !path.trim().is_empty() => Ok(normalize_document_path(path)),
        _ => derive_notes_file_path(document_path),
    }
}

fn derive_recovered_notes_file_path(document_path: &str) -> Result<PathBuf, String> {
    let default_notes_file_path = derive_notes_file_path(document_path)?;
    let parent = default_notes_file_path.parent().unwrap_or(Path::new(""));
    let file_name = default_notes_file_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Unable to derive recovered notes file name.".to_string())?;
    let base_name = file_name
        .strip_suffix(".notes.json")
        .unwrap_or(file_name);

    let primary_candidate = parent.join(format!("{base_name}.recovered.notes.json"));

    if !primary_candidate.exists() {
        return Ok(primary_candidate);
    }

    for index in 2..10_000 {
        let candidate = parent.join(format!("{base_name}.recovered-{index}.notes.json"));

        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err("Could not derive a free recovered notes file name.".to_string())
}

fn write_notes_file(notes_file_path: &Path, contents: String) -> Result<String, String> {
    fs::write(notes_file_path, contents).map_err(|error| {
        format!(
            "Failed to write {}: {}",
            notes_file_path.display(),
            error
        )
    })?;

    Ok(notes_file_path.display().to_string())
}

fn extract_top_level_json_string_field(contents: &str, key: &str) -> Option<String> {
    let key_pattern = format!("\"{key}\"");
    let key_start = contents.find(&key_pattern)?;
    let after_key = &contents[key_start + key_pattern.len()..];
    let colon_index = after_key.find(':')?;
    let mut chars = after_key[colon_index + 1..].char_indices().peekable();

    while let Some((_, character)) = chars.peek() {
        if character.is_whitespace() {
            chars.next();
            continue;
        }
        break;
    }

    let (_, opening_quote) = chars.next()?;
    if opening_quote != '"' {
        return None;
    }

    let mut value = String::new();
    let mut is_escaped = false;

    for (_, character) in chars {
        if is_escaped {
            match character {
                '"' => value.push('"'),
                '\\' => value.push('\\'),
                '/' => value.push('/'),
                'b' => value.push('\u{0008}'),
                'f' => value.push('\u{000C}'),
                'n' => value.push('\n'),
                'r' => value.push('\r'),
                't' => value.push('\t'),
                'u' => return None,
                _ => value.push(character),
            }
            is_escaped = false;
            continue;
        }

        match character {
            '\\' => is_escaped = true,
            '"' => return Some(value),
            _ => value.push(character),
        }
    }

    None
}

fn is_supported_notes_source_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "txt" | "docx" | "pdf"))
        .unwrap_or(false)
}

fn is_supported_recovered_notes_file_name(
    candidate_name: &str,
    expected_notes_file_name: &str,
) -> bool {
    let Some(expected_base_name) = expected_notes_file_name.strip_suffix(".notes.json") else {
        return false;
    };

    if candidate_name == format!("{expected_base_name}.recovered.notes.json") {
        return true;
    }

    let Some(numbered_suffix) = candidate_name
        .strip_prefix(&format!("{expected_base_name}.recovered-"))
        .and_then(|suffix| suffix.strip_suffix(".notes.json"))
    else {
        return false;
    };

    !numbered_suffix.is_empty()
        && numbered_suffix
            .chars()
            .all(|character| character.is_ascii_digit())
}

fn derive_source_document_file_name_from_notes_file_name(candidate_name: &str) -> Option<String> {
    if candidate_name.ends_with(".docx.notes.json") || candidate_name.ends_with(".pdf.notes.json") {
        return candidate_name
            .strip_suffix(".notes.json")
            .map(ToOwned::to_owned);
    }

    candidate_name
        .strip_suffix(".notes.json")
        .map(|stem| format!("{stem}.txt"))
}

fn is_plausible_renamed_notes_candidate(
    candidate_path: &Path,
    parent: &Path,
    expected_notes_file_path: &Path,
    contents: &str,
) -> bool {
    let Some(candidate_name) = candidate_path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let Some(expected_notes_file_name) = expected_notes_file_path
        .file_name()
        .and_then(|name| name.to_str())
    else {
        return false;
    };

    if is_supported_recovered_notes_file_name(candidate_name, expected_notes_file_name) {
        return true;
    }

    let Some(source_document_file_name) =
        derive_source_document_file_name_from_notes_file_name(candidate_name)
    else {
        return false;
    };
    let derived_source_document_path = parent.join(&source_document_file_name);

    if derived_source_document_path.exists()
        && is_supported_notes_source_extension(&derived_source_document_path)
    {
        return true;
    }

    extract_top_level_json_string_field(contents, "documentPath")
        .map(|saved_document_path| normalize_document_path(&saved_document_path))
        .filter(|saved_document_path| is_supported_notes_source_extension(saved_document_path))
        .and_then(|saved_document_path| {
            saved_document_path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|saved_name| saved_name.eq_ignore_ascii_case(&source_document_file_name))
        })
        .unwrap_or(false)
}

fn derive_notes_export_file_path(document_path: &str) -> Result<PathBuf, String> {
    let path = normalize_document_path(document_path);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Unable to derive notes export file name.".to_string())?;
    let parent = path.parent().unwrap_or(Path::new(""));

    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("txt"))
        .unwrap_or(false)
    {
        let file_stem = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .ok_or_else(|| "Unable to derive notes export file name.".to_string())?;

        Ok(parent.join(format!("{file_stem}.notes-export.md")))
    } else {
        Ok(parent.join(format!("{file_name}.notes-export.md")))
    }
}

fn derive_notes_print_file_path(document_path: &str) -> Result<PathBuf, String> {
    let path = normalize_document_path(document_path);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Unable to derive printable notes file name.".to_string())?;
    let parent = path.parent().unwrap_or(Path::new(""));

    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("txt"))
        .unwrap_or(false)
    {
        let file_stem = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .ok_or_else(|| "Unable to derive printable notes file name.".to_string())?;

        Ok(parent.join(format!("{file_stem}.notes-print.html")))
    } else {
        Ok(parent.join(format!("{file_name}.notes-print.html")))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenedTextFile {
    content_hash: String,
    document_kind: String,
    encoding: String,
    text: String,
    warning: Option<String>,
    size_bytes: u64,
    modified_at: Option<u64>,
}

fn open_pdf_file(bytes: &[u8], size_bytes: u64, modified_at: Option<u64>) -> OpenedTextFile {
    OpenedTextFile {
        content_hash: compute_content_hash(bytes),
        document_kind: "pdf".to_string(),
        encoding: "binary-pdf".to_string(),
        text: String::new(),
        warning: Some("PDF support is limited in this version.".to_string()),
        size_bytes,
        modified_at,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NotesFileCandidate {
    contents: String,
    notes_file_path: String,
}

fn compute_content_hash(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!("{digest:x}")
}

fn strip_leading_bom(text: String) -> String {
    text.strip_prefix('\u{feff}')
        .map(ToOwned::to_owned)
        .unwrap_or(text)
}

fn decode_text_file(bytes: &[u8], size_bytes: u64, modified_at: Option<u64>) -> OpenedTextFile {
    let content_hash = compute_content_hash(bytes);

    if let Some(utf8_bytes) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        let text = String::from_utf8_lossy(utf8_bytes).into_owned();

        return OpenedTextFile {
            content_hash,
            document_kind: "txt".to_string(),
            encoding: "utf-8-bom".to_string(),
            text: strip_leading_bom(text),
            warning: None,
            size_bytes,
            modified_at,
        };
    }

    if let Some(utf16le_bytes) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        let (decoded, _, had_errors) = UTF_16LE.decode(utf16le_bytes);

        return OpenedTextFile {
            content_hash,
            document_kind: "txt".to_string(),
            encoding: "utf-16le".to_string(),
            text: strip_leading_bom(decoded.into_owned()),
            warning: had_errors.then(|| "Opened with UTF-16 decoding recovery.".to_string()),
            size_bytes,
            modified_at,
        };
    }

    if let Some(utf16be_bytes) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        let (decoded, _, had_errors) = UTF_16BE.decode(utf16be_bytes);

        return OpenedTextFile {
            content_hash,
            document_kind: "txt".to_string(),
            encoding: "utf-16be".to_string(),
            text: strip_leading_bom(decoded.into_owned()),
            warning: had_errors.then(|| "Opened with UTF-16 decoding recovery.".to_string()),
            size_bytes,
            modified_at,
        };
    }

    match String::from_utf8(bytes.to_vec()) {
        Ok(text) => OpenedTextFile {
            content_hash,
            document_kind: "txt".to_string(),
            encoding: "utf-8".to_string(),
            text: strip_leading_bom(text),
            warning: None,
            size_bytes,
            modified_at,
        },
        Err(_) => {
            let (decoded, _, had_errors) = WINDOWS_1252.decode(bytes);

            OpenedTextFile {
                content_hash,
                document_kind: "txt".to_string(),
                encoding: "windows-1252".to_string(),
                text: strip_leading_bom(decoded.into_owned()),
                warning: Some(if had_errors {
                    "Opened with legacy text encoding fallback.".to_string()
                } else {
                    "Opened with Windows text encoding fallback.".to_string()
                }),
                size_bytes,
                modified_at,
            }
        }
    }
}

fn extract_docx_plain_text(
    bytes: &[u8],
    content_hash: String,
    size_bytes: u64,
    modified_at: Option<u64>,
) -> Result<OpenedTextFile, String> {
    let cursor = Cursor::new(bytes);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|error| format!("Could not read DOCX container: {error}"))?;
    let mut document_xml = String::new();
    archive
        .by_name("word/document.xml")
        .map_err(|error| format!("Could not read word/document.xml: {error}"))?
        .read_to_string(&mut document_xml)
        .map_err(|error| format!("Could not read DOCX document text: {error}"))?;

    let mut reader = Reader::from_str(&document_xml);
    reader.config_mut().trim_text(false);

    let mut paragraphs: Vec<String> = Vec::new();
    let mut current_paragraph = String::new();
    let mut inside_paragraph = false;

    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => match event.name().as_ref() {
                b"w:p" => {
                    if inside_paragraph {
                        let text = current_paragraph.trim().to_string();
                        if !text.is_empty() {
                            paragraphs.push(text);
                        }
                        current_paragraph.clear();
                    }
                    inside_paragraph = true;
                }
                b"w:tab" => {
                    if inside_paragraph {
                        current_paragraph.push('\t');
                    }
                }
                b"w:br" | b"w:cr" => {
                    if inside_paragraph && !current_paragraph.ends_with(' ') {
                        current_paragraph.push(' ');
                    }
                }
                _ => {}
            },
            Ok(Event::Empty(event)) => match event.name().as_ref() {
                b"w:tab" => {
                    if inside_paragraph {
                        current_paragraph.push('\t');
                    }
                }
                b"w:br" | b"w:cr" => {
                    if inside_paragraph && !current_paragraph.ends_with(' ') {
                        current_paragraph.push(' ');
                    }
                }
                _ => {}
            },
            Ok(Event::Text(event)) => {
                if inside_paragraph {
                    let decoded = reader
                        .decoder()
                        .decode(event.as_ref())
                        .map_err(|error| format!("Could not decode DOCX text: {error}"))?;
                    let unescaped = unescape(&decoded)
                        .map_err(|error| format!("Could not decode DOCX text: {error}"))?;
                    current_paragraph.push_str(unescaped.as_ref());
                }
            }
            Ok(Event::End(event)) => {
                if event.name().as_ref() == b"w:p" {
                    let text = current_paragraph.trim().to_string();
                    if !text.is_empty() {
                        paragraphs.push(text);
                    }
                    current_paragraph.clear();
                    inside_paragraph = false;
                }
            }
            Ok(Event::Eof) => break,
            Err(error) => {
                return Err(format!("Could not parse DOCX document text: {error}"));
            }
            _ => {}
        }
    }

    if inside_paragraph {
        let text = current_paragraph.trim().to_string();
        if !text.is_empty() {
            paragraphs.push(text);
        }
    }

    let extracted_text = paragraphs.join("\n\n");

    if extracted_text.trim().is_empty() {
        return Err(
            "Could not open DOCX file. This version supports simple DOCX text extraction only."
                .to_string(),
        );
    }

    Ok(OpenedTextFile {
        content_hash,
        document_kind: "docx".to_string(),
        encoding: "docx-xml".to_string(),
        text: extracted_text,
        warning: Some("DOCX plain text".to_string()),
        size_bytes,
        modified_at,
    })
}

#[tauri::command]
fn open_document_file(document_path: String) -> Result<OpenedTextFile, String> {
    let normalized_path = normalize_document_path(&document_path);
    let metadata = fs::metadata(&normalized_path).map_err(|error| {
        format!(
            "Failed to read metadata for {}: {}",
            normalized_path.display(),
            error
        )
    })?;
    let bytes = fs::read(&normalized_path).map_err(|error| {
        format!(
            "Failed to read {}: {}",
            normalized_path.display(),
            error
        )
    })?;
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64);

    let opened_file = match normalized_path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("txt") => decode_text_file(&bytes, metadata.len(), modified_at),
        Some("docx") => extract_docx_plain_text(
            &bytes,
            compute_content_hash(&bytes),
            metadata.len(),
            modified_at,
        )?,
        Some("pdf") => open_pdf_file(&bytes, metadata.len(), modified_at),
        _ => {
            return Err(format!(
                "Unsupported document type for {}. NoteAnchor currently supports .txt, .docx, and supported .pdf files.",
                normalized_path.display()
            ))
        }
    };

    println!(
        "[NoteAnchor desktop open] opened {} as {} using {} ({} bytes, modified {:?})",
        normalized_path.display(),
        opened_file.document_kind,
        opened_file.encoding,
        opened_file.size_bytes,
        opened_file.modified_at
    );

    Ok(opened_file)
}

#[tauri::command]
fn read_document_bytes(document_path: String) -> Result<Vec<u8>, String> {
    let normalized_path = normalize_document_path(&document_path);

    fs::read(&normalized_path).map_err(|error| {
        format!(
            "Failed to read {}: {}",
            normalized_path.display(),
            error
        )
    })
}

#[tauri::command]
fn load_notes_file(document_path: String) -> Result<Option<String>, String> {
    let notes_file_path = derive_notes_file_path(&document_path)?;
    println!(
        "[NoteAnchor notes] loading notes for {} -> {}",
        document_path,
        notes_file_path.display()
    );

    match fs::read_to_string(&notes_file_path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!(
            "Failed to read {}: {}",
            notes_file_path.display(),
            error
        )),
    }
}

#[tauri::command]
fn find_renamed_notes_candidates(document_path: String) -> Result<Vec<NotesFileCandidate>, String> {
    let normalized_path = normalize_document_path(&document_path);
    let expected_notes_file_path = derive_notes_file_path(&document_path)?;
    let parent = normalized_path.parent().ok_or_else(|| {
        format!(
            "Failed to inspect notes folder for {}.",
            normalized_path.display()
        )
    })?;

    let mut candidates = Vec::new();

    for entry in fs::read_dir(parent).map_err(|error| {
        format!("Failed to inspect {}: {}", parent.display(), error)
    })? {
        let entry = entry.map_err(|error| {
            format!("Failed to inspect {}: {}", parent.display(), error)
        })?;
        let path = entry.path();

        if path == expected_notes_file_path {
            continue;
        }

        let is_notes_file = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.to_ascii_lowercase().ends_with(".notes.json"))
            .unwrap_or(false);

        if !is_notes_file {
            continue;
        }

        let contents = fs::read_to_string(&path).map_err(|error| {
            format!("Failed to read {}: {}", path.display(), error)
        })?;

        if !is_plausible_renamed_notes_candidate(&path, parent, &expected_notes_file_path, &contents)
        {
            continue;
        }

        candidates.push(NotesFileCandidate {
            contents,
            notes_file_path: path.display().to_string(),
        });
    }

    println!(
        "[NoteAnchor notes] found {} renamed-notes candidates in {}",
        candidates.len(),
        parent.display()
    );

    Ok(candidates)
}

#[tauri::command]
fn save_notes_file(
    document_path: String,
    contents: String,
    notes_file_path: Option<String>,
) -> Result<String, String> {
    let notes_file_path = resolve_notes_file_path(&document_path, notes_file_path.as_deref())?;
    println!(
        "[NoteAnchor notes] saving notes for {} -> {} ({} bytes)",
        document_path,
        notes_file_path.display(),
        contents.len()
    );

    write_notes_file(&notes_file_path, contents)
}

#[tauri::command]
fn save_recovered_notes_file(document_path: String, contents: String) -> Result<String, String> {
    let recovered_notes_file_path = derive_recovered_notes_file_path(&document_path)?;
    println!(
        "[NoteAnchor notes] saving recovered notes for {} -> {} ({} bytes)",
        document_path,
        recovered_notes_file_path.display(),
        contents.len()
    );

    write_notes_file(&recovered_notes_file_path, contents)
}

#[tauri::command]
fn clear_notes_file(document_path: String, notes_file_path: Option<String>) -> Result<String, String> {
    let notes_file_path = resolve_notes_file_path(&document_path, notes_file_path.as_deref())?;
    println!(
        "[NoteAnchor notes] clearing notes for {} -> {}",
        document_path,
        notes_file_path.display()
    );

    if notes_file_path.exists() {
        fs::remove_file(&notes_file_path).map_err(|error| {
            format!(
                "Failed to remove {}: {}",
                notes_file_path.display(),
                error
            )
        })?;
    }

    Ok(notes_file_path.display().to_string())
}

#[tauri::command]
fn save_notes_export_file(document_path: String, contents: String) -> Result<String, String> {
    let export_file_path = derive_notes_export_file_path(&document_path)?;
    println!(
        "[NoteAnchor export] saving notes export for {} -> {} ({} bytes)",
        document_path,
        export_file_path.display(),
        contents.len()
    );

    fs::write(&export_file_path, contents).map_err(|error| {
        format!(
            "Failed to write {}: {}",
            export_file_path.display(),
            error
        )
    })?;

    Ok(export_file_path.display().to_string())
}

#[tauri::command]
fn save_notes_print_file(document_path: String, contents: String) -> Result<String, String> {
    let print_file_path = derive_notes_print_file_path(&document_path)?;
    println!(
        "[NoteAnchor print] saving printable HTML for {} -> {} ({} bytes)",
        document_path,
        print_file_path.display(),
        contents.len()
    );

    fs::write(&print_file_path, contents).map_err(|error| {
        format!(
            "Failed to write {}: {}",
            print_file_path.display(),
            error
        )
    })?;

    Ok(print_file_path.display().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            clear_notes_file,
            find_renamed_notes_candidates,
            load_notes_file,
            open_document_file,
            ping,
            read_document_bytes,
            save_recovered_notes_file,
            save_notes_export_file,
            save_notes_print_file,
            save_notes_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
