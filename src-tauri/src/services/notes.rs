use base64::Engine;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    env, fmt, fs, io,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};
use uuid::Uuid;

static NOTE_WRITES: Mutex<()> = Mutex::new(());

fn lock_note_writes() -> Result<MutexGuard<'static, ()>, AppError> {
    NOTE_WRITES
        .lock()
        .map_err(|_| AppError::new("noteStoreLocked", "暂时无法保存笔记"))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub notes_dir: String,
    pub global_shortcut: String,
    pub close_to_tray: bool,
    pub autostart: bool,
    pub default_view_mode: String,
    #[serde(default = "default_note_auto_save")]
    pub note_auto_save: bool,
    #[serde(default = "default_note_surface_auto_save")]
    pub note_surface_auto_save: bool,
    #[serde(default = "default_tile_color")]
    pub tile_color: String,
    #[serde(default = "default_tile_color_mode")]
    pub tile_color_mode: String,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    #[serde(default = "default_surface_font_size")]
    pub surface_font_size: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveNoteRequest {
    pub title: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum NoteGroupTarget {
    Existing { id: String },
    Named { title: String },
    Root,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteMetadata {
    pub id: String,
    pub title: String,
    pub file_name: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub word_count: usize,
    pub preview: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(default = "default_sort_order")]
    pub sort_order: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<NoteIcon>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub file_name: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub word_count: usize,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(default = "default_sort_order")]
    pub sort_order: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<NoteIcon>,
}

impl NoteMetadata {
    fn into_note(self, content: String) -> Note {
        Note {
            id: self.id,
            title: self.title,
            file_name: self.file_name,
            created_at: self.created_at,
            updated_at: self.updated_at,
            word_count: self.word_count,
            content,
            parent_id: self.parent_id,
            sort_order: self.sort_order,
            icon: self.icon,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
pub enum NoteIcon {
    Emoji(String),
    Image(String),
}

impl NoteIcon {
    fn is_valid(&self) -> bool {
        match self {
            Self::Emoji(value) => {
                !value.is_empty()
                    && value.len() <= 128
                    && !value.chars().any(|ch| ch.is_whitespace() || ch.is_control())
            }
            Self::Image(value) => {
                if value.len() > 16_384 {
                    return false;
                }
                let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(value) else {
                    return false;
                };
                // The picker renders uploads onto a 48×48 canvas before saving them.
                bytes.get(..24) == Some(b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR\0\0\0\x30\0\0\0\x30")
            }
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NoteDropPosition {
    Before,
    After,
    Inside,
}

/// Formatting is stored separately from the Markdown document. Offsets use UTF-16.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StyleRange {
    pub start: usize,
    pub end: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StyleDocument {
    pub content: String,
    pub ranges: Vec<StyleRange>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bookmarks: Vec<NoteBookmark>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteBookmark {
    pub id: String,
    pub name: String,
    pub offset: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteReorderEntry {
    pub id: String,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub message: String,
}

impl AppError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self::new("notFound", message)
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<io::Error> for AppError {
    fn from(error: io::Error) -> Self {
        Self::new("io", error.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        Self::new("json", error.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(error: tauri::Error) -> Self {
        Self::new("tauri", error.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct MetadataFile {
    notes: Vec<NoteMetadata>,
}

#[derive(Debug, Clone)]
pub struct NoteStore {
    base_dir: PathBuf,
}

pub fn default_store() -> Result<NoteStore, AppError> {
    Ok(NoteStore::new(default_base_dir()?))
}

fn default_base_dir() -> Result<PathBuf, AppError> {
    if let Ok(path) = env::var("FLORAL_NOTEPAPER_DATA_DIR") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    if let Ok(user_profile) = env::var("USERPROFILE") {
        return Ok(PathBuf::from(user_profile).join("Documents").join("花笺"));
    }

    Ok(env::current_dir()?.join("data"))
}

impl NoteStore {
    pub fn new(base_dir: PathBuf) -> Self {
        Self { base_dir }
    }

    pub fn base_dir(&self) -> &Path {
        &self.base_dir
    }

    pub fn metadata_path(&self) -> PathBuf {
        self.base_dir.join("metadata.json")
    }

    pub fn config_path(&self) -> PathBuf {
        self.base_dir.join("config.json")
    }

    pub fn load_config(&self) -> Result<AppConfig, AppError> {
        self.ensure_base_dir()?;
        let path = self.config_path();
        if !path.exists() {
            let config = self.default_config();
            self.save_config(config.clone())?;
            return Ok(config);
        }

        let config: AppConfig = serde_json::from_str(&fs::read_to_string(path)?)?;
        fs::create_dir_all(&config.notes_dir)?;
        Ok(config)
    }

    pub fn save_config(&self, config: AppConfig) -> Result<(), AppError> {
        self.ensure_base_dir()?;
        fs::create_dir_all(&config.notes_dir)?;
        write_json_atomic(&self.config_path(), &config)
    }

    pub fn list_notes(&self) -> Result<Vec<NoteMetadata>, AppError> {
        let _guard = lock_note_writes()?;
        self.ensure_storage()?;
        let mut metadata = self.load_metadata()?.notes;
        metadata.retain(|note| self.note_path(&note.file_name).exists());
        metadata.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        Ok(metadata)
    }

    pub fn read_note(&self, id: &str) -> Result<Note, AppError> {
        let _guard = lock_note_writes()?;
        self.ensure_storage()?;
        let metadata = self.find_metadata(id)?;
        let content = fs::read_to_string(self.note_path(&metadata.file_name))?;
        Ok(metadata.into_note(content))
    }

    pub fn create_note(&self, request: SaveNoteRequest) -> Result<Note, AppError> {
        self.save_note(None, request, None)
    }

    pub fn update_note(&self, id: &str, request: SaveNoteRequest) -> Result<Note, AppError> {
        self.save_note(Some(id), request, None)
    }

    pub fn save_grouped_note(
        &self,
        id: Option<&str>,
        request: SaveNoteRequest,
        group: NoteGroupTarget,
    ) -> Result<Note, AppError> {
        self.save_note(id, request, Some(group))
    }

    fn save_note(
        &self,
        id: Option<&str>,
        request: SaveNoteRequest,
        group: Option<NoteGroupTarget>,
    ) -> Result<Note, AppError> {
        let _guard = lock_note_writes()?;
        self.ensure_storage()?;
        let mut metadata_file = self.load_metadata()?;
        let notes_dir = self.notes_dir()?;
        let index = id
            .map(|id| {
                metadata_file.notes.iter().position(|note| note.id == id)
                    .ok_or_else(|| AppError::not_found(format!("Note {id} was not found")))
            })
            .transpose()?;
        let previous = index.map(|index| metadata_file.notes[index].clone());
        let (parent_id, new_group) = match group {
            Some(target) => self.resolve_note_group(&metadata_file.notes, &notes_dir, id, target)?,
            None => {
                let parent_id = match &previous {
                    Some(note) => note.parent_id.clone(),
                    None => request.parent_id.filter(|parent| !parent.is_empty()),
                };
                (parent_id, None)
            }
        };
        let sort_order = match &previous {
            Some(note) if note.parent_id == parent_id => note.sort_order,
            _ => next_sort_order(&metadata_file.notes, parent_id.as_deref()),
        };
        let id = id.map(str::to_owned).unwrap_or_else(|| Uuid::new_v4().to_string());
        let now = Utc::now();
        let note = NoteMetadata {
            file_name: self.file_name_for(&id, &request.title),
            id,
            title: request.title,
            created_at: previous.as_ref().map_or(now, |note| note.created_at),
            updated_at: now,
            word_count: count_words(&request.content),
            preview: preview(&request.content),
            parent_id,
            sort_order,
            icon: previous.as_ref().and_then(|note| note.icon.clone()),
        };

        let note_path = notes_dir.join(&note.file_name);
        let old_path = previous.as_ref().map(|note| notes_dir.join(&note.file_name));
        let group_path = new_group.as_ref().map(|group| notes_dir.join(&group.file_name));
        if let Some(group) = new_group {
            metadata_file.notes.push(group);
        }
        match index {
            Some(index) => metadata_file.notes[index] = note.clone(),
            None => metadata_file.notes.push(note.clone()),
        }

        let saved = (|| -> Result<(), AppError> {
            if let Some(path) = &group_path {
                fs::write(path, "")?;
            }
            fs::write(&note_path, &request.content)?;
            self.save_metadata(&metadata_file)
        })();
        if let Err(error) = saved {
            if let Some(path) = group_path {
                let _ = fs::remove_file(path);
            }
            if old_path.as_ref() != Some(&note_path) {
                let _ = fs::remove_file(&note_path);
            }
            return Err(error);
        }
        if let Some(path) = old_path.filter(|path| path != &note_path) {
            let _ = fs::remove_file(path);
        }
        Ok(note.into_note(request.content))
    }

    fn resolve_note_group(
        &self,
        notes: &[NoteMetadata],
        notes_dir: &Path,
        note_id: Option<&str>,
        target: NoteGroupTarget,
    ) -> Result<(Option<String>, Option<NoteMetadata>), AppError> {
        let parent = match target {
            NoteGroupTarget::Root => return Ok((None, None)),
            NoteGroupTarget::Existing { id } => notes
                .iter()
                .find(|note| note.id == id && notes_dir.join(&note.file_name).is_file())
                .ok_or_else(|| AppError::not_found("该分组已不存在，请重新选择"))?,
            NoteGroupTarget::Named { title } => {
                let title = title.trim();
                if title.is_empty() {
                    return Err(AppError::new("invalidNoteGroup", "请输入分组名称"));
                }
                let normalized = title.to_lowercase();
                let mut matches = notes.iter().filter(|note| {
                    note.title.trim().to_lowercase() == normalized
                        && notes_dir.join(&note.file_name).is_file()
                });
                match (matches.next(), matches.next()) {
                    (Some(parent), None) => parent,
                    (Some(_), Some(_)) => {
                        return Err(AppError::new("ambiguousNoteGroup", "有多个同名分组，请从列表选取"));
                    }
                    _ => {
                        let id = Uuid::new_v4().to_string();
                        let now = Utc::now();
                        let group = NoteMetadata {
                            file_name: self.file_name_for(&id, title),
                            id,
                            title: title.to_owned(),
                            created_at: now,
                            updated_at: now,
                            word_count: 0,
                            preview: String::new(),
                            parent_id: None,
                            sort_order: next_sort_order(notes, None),
                            icon: None,
                        };
                        return Ok((Some(group.id.clone()), Some(group)));
                    }
                }
            }
        };
        validate_note_ancestry(notes, note_id, &parent.id)?;
        Ok((Some(parent.id.clone()), None))
    }

    pub fn set_note_icon(&self, id: &str, icon: Option<NoteIcon>) -> Result<(), AppError> {
        if icon.as_ref().is_some_and(|icon| !icon.is_valid()) {
            return Err(AppError::new("invalidNoteIcon", "笔记图标无效"));
        }
        let _guard = lock_note_writes()?;
        let mut metadata = self.load_metadata()?;
        let note = metadata
            .notes
            .iter_mut()
            .find(|note| note.id == id)
            .ok_or_else(|| AppError::not_found(format!("Note {id} was not found")))?;
        note.icon = icon;
        self.save_metadata(&metadata)
    }

    fn collect_descendant_ids(notes: &[NoteMetadata], parent_id: &str) -> Vec<String> {
        let mut ids = Vec::new();
        for note in notes {
            if note.parent_id.as_deref() == Some(parent_id) {
                ids.push(note.id.clone());
                ids.extend(Self::collect_descendant_ids(notes, &note.id));
            }
        }
        ids
    }

    pub fn delete_note(&self, id: &str) -> Result<(), AppError> {
        let _guard = lock_note_writes()?;
        self.ensure_storage()?;
        let mut metadata_file = self.load_metadata()?;
        let index = metadata_file
            .notes
            .iter()
            .position(|note| note.id == id)
            .ok_or_else(|| AppError::not_found(format!("Note {id} was not found")))?;

        let metadata = metadata_file.notes.remove(index);
        let mut deleted_ids = vec![metadata.id.clone()];
        deleted_ids.extend(Self::collect_descendant_ids(
            &metadata_file.notes,
            &metadata.id,
        ));

        // Delete all .md files for the deleted notes and their descendants
        for deleted_id in &deleted_ids[1..] {
            if let Some(pos) = metadata_file.notes.iter().position(|n| n.id == *deleted_id) {
                let child_meta = metadata_file.notes.remove(pos);
                let path = self.note_path(&child_meta.file_name);
                if path.exists() {
                    fs::remove_file(path)?;
                }
            }
        }

        let path = self.note_path(&metadata.file_name);
        if path.exists() {
            fs::remove_file(path)?;
        }
        self.save_metadata(&metadata_file)
    }

    pub fn move_note(
        &self,
        id: &str,
        target_id: &str,
        position: NoteDropPosition,
    ) -> Result<(), AppError> {
        let _guard = lock_note_writes()?;
        self.ensure_storage()?;
        let mut metadata = self.load_metadata()?;
        let target = metadata
            .notes
            .iter()
            .find(|note| note.id == target_id)
            .ok_or_else(|| AppError::not_found(format!("Note {target_id} was not found")))?;
        let new_parent = match position {
            NoteDropPosition::Inside => Some(target.id.clone()),
            _ => target.parent_id.clone(),
        };

        validate_note_ancestry(&metadata.notes, Some(id), target_id)?;

        let index = metadata
            .notes
            .iter()
            .position(|note| note.id == id)
            .ok_or_else(|| AppError::not_found(format!("Note {id} was not found")))?;
        let mut siblings: Vec<usize> = metadata
            .notes
            .iter()
            .enumerate()
            .filter_map(|(i, note)| (i != index && note.parent_id == new_parent).then_some(i))
            .collect();
        siblings.sort_by(|&left, &right| {
            let left = &metadata.notes[left];
            let right = &metadata.notes[right];
            left.sort_order
                .cmp(&right.sort_order)
                .then_with(|| right.updated_at.cmp(&left.updated_at))
        });
        let insert_at = match position {
            NoteDropPosition::Inside => siblings.len(),
            _ => {
                let target_index = siblings
                    .iter()
                    .position(|&i| metadata.notes[i].id == target_id)
                    .ok_or_else(|| AppError::not_found(format!("Note {target_id} was not found")))?;
                target_index + usize::from(position == NoteDropPosition::After)
            }
        };

        metadata.notes[index].parent_id = new_parent;
        siblings.insert(insert_at, index);
        for (order, i) in siblings.into_iter().enumerate() {
            metadata.notes[i].sort_order = order as i32;
        }
        self.save_metadata(&metadata)
    }

    pub fn reorder_notes(&self, orders: Vec<NoteReorderEntry>) -> Result<(), AppError> {
        let _guard = lock_note_writes()?;
        self.ensure_storage()?;
        let mut metadata_file = self.load_metadata()?;

        for entry in &orders {
            if let Some(note) = metadata_file
                .notes
                .iter_mut()
                .find(|note| note.id == entry.id)
            {
                note.sort_order = entry.sort_order;
            }
        }

        self.save_metadata(&metadata_file)
    }

    /// Return the saved snapshot even if the Markdown was changed externally, so
    /// callers can surface the conflict without discarding formatting data.
    pub fn read_note_styles(&self, id: &str) -> Result<Option<StyleDocument>, AppError> {
        self.find_metadata(id)?;
        let path = self.style_path(id)?;
        if !path.exists() { return Ok(None); }
        Ok(Some(serde_json::from_str(&fs::read_to_string(path)?)?))
    }

    pub fn save_note_styles(&self, id: &str, document: StyleDocument) -> Result<(), AppError> {
        let current = self.read_note_content(id)?;
        if current != document.content {
            return Err(AppError::new("styleConflict", "笔记内容已变化，无法保存旧的文字格式"));
        }
        let mut boundaries = vec![0];
        let mut line_starts = vec![0];
        let mut offset = 0;
        let mut characters = current.chars().peekable();
        while let Some(character) = characters.next() {
            offset += character.len_utf16();
            boundaries.push(offset);
            if character == '\n' || (character == '\r' && characters.peek() != Some(&'\n')) {
                line_starts.push(offset);
            }
        }
        for range in &document.ranges {
            if range.start >= range.end || boundaries.binary_search(&range.start).is_err() || boundaries.binary_search(&range.end).is_err() {
                return Err(AppError::new("invalidStyleRange", "文字格式范围无效"));
            }
        }
        let mut bookmark_ids = std::collections::HashSet::new();
        for bookmark in &document.bookmarks {
            if bookmark.id.is_empty()
                || !bookmark_ids.insert(&bookmark.id)
                || line_starts.binary_search(&bookmark.offset).is_err()
            {
                return Err(AppError::new("invalidBookmark", "书签位置无效"));
            }
        }
        write_json_atomic(&self.style_path(id)?, &document)
    }

    fn style_path(&self, id: &str) -> Result<PathBuf, AppError> {
        // Metadata can be rebuilt from filenames, so reject paths even if metadata is malformed.
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            return Err(AppError::new("invalidNoteId", "笔记标识无效"));
        }
        Ok(self.notes_dir()?.join(".floral-styles").join(format!("{id}.json")))
    }

    pub fn read_note_content(&self, id: &str) -> Result<String, AppError> {
        let metadata = self.find_metadata(id)?;
        Ok(fs::read_to_string(self.note_path(&metadata.file_name))?)
    }

    pub fn import_markdown_file(&self, path: &Path) -> Result<Note, AppError> {
        if !is_markdown_path(path) {
            return Err(AppError::new("unsupportedFile", "只支持导入 .md 文件"));
        }

        let content = fs::read_to_string(path)?;
        let title = imported_markdown_title(path, &content);
        self.create_note(SaveNoteRequest { title, content, parent_id: None })
    }

    pub fn export_markdown_file(&self, id: &str, path: &Path) -> Result<(), AppError> {
        let note = self.read_note(id)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, note.content)?;
        Ok(())
    }

    fn default_config(&self) -> AppConfig {
        AppConfig {
            notes_dir: self.base_dir.join("notes").to_string_lossy().to_string(),
            global_shortcut: "Ctrl+Space".into(),
            close_to_tray: true,
            autostart: false,
            default_view_mode: "split".into(),
            note_auto_save: true,
            note_surface_auto_save: true,
            tile_color: default_tile_color(),
            tile_color_mode: default_tile_color_mode(),
            theme: default_theme(),
            font_size: default_font_size(),
            surface_font_size: default_surface_font_size(),
        }
    }

    fn ensure_base_dir(&self) -> Result<(), AppError> {
        fs::create_dir_all(&self.base_dir)?;
        Ok(())
    }

    fn ensure_storage(&self) -> Result<(), AppError> {
        self.ensure_base_dir()?;
        let config = self.load_config()?;
        fs::create_dir_all(&config.notes_dir)?;
        if !self.metadata_path().exists() {
            self.save_metadata(&MetadataFile::default())?;
        }
        Ok(())
    }

    fn notes_dir(&self) -> Result<PathBuf, AppError> {
        Ok(PathBuf::from(self.load_config()?.notes_dir))
    }

    fn note_path(&self, file_name: &str) -> PathBuf {
        let notes_dir = self
            .notes_dir()
            .unwrap_or_else(|_| self.base_dir.join("notes"));
        notes_dir.join(file_name)
    }

    fn find_metadata(&self, id: &str) -> Result<NoteMetadata, AppError> {
        self.load_metadata()?
            .notes
            .into_iter()
            .find(|note| note.id == id)
            .ok_or_else(|| AppError::not_found(format!("Note {id} was not found")))
    }

    fn file_name_for(&self, id: &str, title: &str) -> String {
        let safe_title = safe_file_stem(title);
        if safe_title.is_empty() {
            format!("{id}.md")
        } else {
            format!("{id}_{safe_title}.md")
        }
    }

    fn load_metadata(&self) -> Result<MetadataFile, AppError> {
        self.ensure_base_dir()?;
        let path = self.metadata_path();
        if !path.exists() {
            let rebuilt = self.rebuild_metadata()?;
            self.save_metadata(&rebuilt)?;
            return Ok(rebuilt);
        }

        match serde_json::from_str(&fs::read_to_string(&path)?) {
            Ok(metadata) => Ok(metadata),
            Err(error) => {
                let corrupt_name = format!(
                    "metadata.corrupt-{}.json",
                    Utc::now().format("%Y%m%d%H%M%S")
                );
                fs::rename(&path, self.base_dir.join(corrupt_name))?;
                let rebuilt = self.rebuild_metadata()?;
                self.save_metadata(&rebuilt)?;
                let _ = error;
                Ok(rebuilt)
            }
        }
    }

    fn save_metadata(&self, metadata: &MetadataFile) -> Result<(), AppError> {
        self.ensure_base_dir()?;
        write_json_atomic(&self.metadata_path(), metadata)
    }

    fn rebuild_metadata(&self) -> Result<MetadataFile, AppError> {
        let notes_dir = self.notes_dir()?;
        fs::create_dir_all(&notes_dir)?;
        let mut notes = Vec::new();

        for entry in fs::read_dir(notes_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|extension| extension.to_str()) != Some("md") {
                continue;
            }

            let file_name = entry.file_name().to_string_lossy().to_string();
            let Some(id) = id_from_file_name(&file_name) else {
                continue;
            };
            let content = fs::read_to_string(&path).unwrap_or_default();
            let title = infer_title(&file_name, &content);
            let modified = entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .map(DateTime::<Utc>::from)
                .unwrap_or_else(|_| Utc::now());

            notes.push(NoteMetadata {
                id,
                title,
                file_name,
                created_at: modified,
                updated_at: modified,
                word_count: count_words(&content),
                preview: preview(&content),
                parent_id: None,
                sort_order: 0,
                icon: None,
            });
        }

        Ok(MetadataFile { notes })
    }
}

fn next_sort_order(notes: &[NoteMetadata], parent_id: Option<&str>) -> i32 {
    notes.iter()
        .filter(|note| note.parent_id.as_deref() == parent_id)
        .map(|note| note.sort_order)
        .max()
        .unwrap_or(-1)
        .saturating_add(1)
}

fn validate_note_ancestry(
    notes: &[NoteMetadata],
    id: Option<&str>,
    parent_id: &str,
) -> Result<(), AppError> {
    let mut visited = HashSet::new();
    let mut ancestor = Some(parent_id);
    while let Some(ancestor_id) = ancestor {
        if Some(ancestor_id) == id || !visited.insert(ancestor_id) {
            return Err(AppError::new("invalidNoteMove", "不能将笔记移入自身或其子笔记"));
        }
        ancestor = notes.iter()
            .find(|note| note.id == ancestor_id)
            .and_then(|note| note.parent_id.as_deref());
    }
    Ok(())
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, serde_json::to_string_pretty(value)?)?;
    fs::rename(temp_path, path)?;
    Ok(())
}

fn safe_file_stem(title: &str) -> String {
    let mut stem = String::new();
    let mut last_was_separator = false;

    for ch in title.trim().chars() {
        let should_separate = ch.is_whitespace()
            || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
            || ch.is_control();

        if should_separate {
            if !stem.is_empty() && !last_was_separator {
                stem.push('_');
                last_was_separator = true;
            }
            continue;
        }

        stem.push(ch);
        last_was_separator = false;
        if stem.chars().count() >= 48 {
            break;
        }
    }

    stem.trim_matches('_').to_string()
}

fn count_words(content: &str) -> usize {
    content.chars().filter(|ch| !ch.is_whitespace()).count()
}

fn preview(content: &str) -> String {
    content
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(80)
        .collect()
}

fn id_from_file_name(file_name: &str) -> Option<String> {
    let stem = file_name.strip_suffix(".md")?;
    Some(
        stem.split_once('_')
            .map(|(id, _)| id.to_string())
            .unwrap_or_else(|| stem.to_string()),
    )
}

fn infer_title(file_name: &str, content: &str) -> String {
    if let Some(title) = content
        .lines()
        .find_map(|line| line.trim().strip_prefix("# ").map(str::trim))
        .filter(|title| !title.is_empty())
    {
        return title.to_string();
    }

    let stem = file_name.strip_suffix(".md").unwrap_or(file_name);
    stem.split_once('_')
        .map(|(_, title)| title.replace('_', " "))
        .unwrap_or_default()
}

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("md"))
        .unwrap_or(false)
}

pub fn read_file_base64(path: &str) -> Result<String, AppError> {
    let path = Path::new(path);
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_lowercase();

    let mime = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        _ => return Err(AppError::new("unsupportedFormat", "不支持的文件格式")),
    };

    let max_size = 10 * 1024 * 1024; // 10MB
    let metadata = fs::metadata(path)?;
    if metadata.len() > max_size {
        return Err(AppError::new("fileTooLarge", "图片文件过大（最大 10MB）"));
    }

    let bytes = fs::read(path)?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, encoded))
}

fn imported_markdown_title(path: &Path, content: &str) -> String {
    let first_line = content.lines().next().unwrap_or_default();
    let first_line = first_line.trim_start_matches('\u{feff}').trim_start();

    if let Some(title) = first_line
        .strip_prefix("# ")
        .map(str::trim)
        .filter(|title| !title.is_empty())
    {
        return title.to_string();
    }

    path.file_stem()
        .and_then(|file_stem| file_stem.to_str())
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .unwrap_or("导入笔记")
        .to_string()
}

fn default_note_auto_save() -> bool {
    true
}

fn default_note_surface_auto_save() -> bool {
    true
}

fn default_tile_color() -> String {
    "#f6f3ec".into()
}

fn default_tile_color_mode() -> String {
    "system".into()
}

fn default_theme() -> String {
    "system".into()
}

fn default_font_size() -> u32 {
    14
}

fn default_surface_font_size() -> u32 {
    14
}

fn default_sort_order() -> i32 {
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf};

    fn test_root(name: &str) -> PathBuf {
        let base = std::env::var_os("FLORAL_NOTEPAPER_TEST_TEMP_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::temp_dir().join("floral-notepaper-rust-tests"));
        let root = base.join(name);
        if root.exists() {
            fs::remove_dir_all(&root).expect("remove stale test root");
        }
        fs::create_dir_all(&root).expect("create test root");
        root
    }

    #[test]
    fn style_sidecar_preserves_markdown_and_rejects_stale_or_invalid_ranges() {
        let store = NoteStore::new(test_root("style-sidecar"));
        let note = store.create_note(SaveNoteRequest {
            title: "样式".into(), content: "甲😀乙".into(), parent_id: None,
        }).expect("create note");
        let document = StyleDocument {
            content: note.content.clone(),
            ranges: vec![StyleRange { start: 1, end: 3, color: Some("red".into()), background: None, size: Some(20) }],
            bookmarks: Vec::new(),
        };
        store.save_note_styles(&note.id, document.clone()).expect("save styles");
        assert_eq!(store.read_note_styles(&note.id).unwrap(), Some(document.clone()));
        assert_eq!(store.read_note_content(&note.id).unwrap(), "甲😀乙");
        let invalid = StyleDocument { ranges: vec![StyleRange { start: 0, end: 99, color: None, background: None, size: None }], ..document.clone() };
        assert_eq!(store.save_note_styles(&note.id, invalid).unwrap_err().code, "invalidStyleRange");
        let split_emoji = StyleDocument { ranges: vec![StyleRange { start: 1, end: 2, color: None, background: None, size: None }], ..document.clone() };
        assert_eq!(store.save_note_styles(&note.id, split_emoji).unwrap_err().code, "invalidStyleRange");
        store.update_note(&note.id, SaveNoteRequest { title: note.title, content: "外部修改".into(), parent_id: None }).unwrap();
        assert_eq!(store.save_note_styles(&note.id, document.clone()).unwrap_err().code, "styleConflict");
        assert_eq!(store.read_note_styles(&note.id).unwrap(), Some(document));
    }

    #[test]
    fn bookmarks_are_saved_per_note_at_utf16_line_boundaries() {
        let base = test_root("bookmarks");
        let store = NoteStore::new(base.clone());
        let content = "😀\r\n第二行\n第三行";
        let request = SaveNoteRequest { title: "笔记".into(), content: content.into(), parent_id: None };
        let first = store.create_note(request.clone()).unwrap();
        let second = store.create_note(request).unwrap();
        let mut document = StyleDocument {
            content: content.into(),
            ranges: Vec::new(),
            bookmarks: vec![NoteBookmark { id: "bookmark".into(), name: String::new(), offset: 4 }],
        };
        store.save_note_styles(&first.id, document.clone()).unwrap();
        let reopened = NoteStore::new(base);
        assert_eq!(reopened.read_note_styles(&first.id).unwrap(), Some(document.clone()));
        assert_eq!(reopened.read_note_styles(&second.id).unwrap(), None);
        assert_eq!(reopened.read_note_content(&first.id).unwrap(), content);
        document.bookmarks[0].offset = 3;
        assert_eq!(store.save_note_styles(&first.id, document).unwrap_err().code, "invalidBookmark");
    }

    #[test]
    fn grouped_save_reuses_the_note_and_appends_it_after_existing_chapters() {
        let store = NoteStore::new(test_root("group-existing"));
        let group = store.create_note(SaveNoteRequest {
            title: "数字电路复习".into(), content: String::new(), parent_id: None,
        }).unwrap();
        let chapter = store.create_note(SaveNoteRequest {
            title: "第八章".into(), content: String::new(), parent_id: Some(group.id.clone()),
        }).unwrap();
        let request = SaveNoteRequest { title: String::new(), content: "章末小结".into(), parent_id: None };
        let draft = store.create_note(request.clone()).unwrap();
        let saved = store.save_grouped_note(
            Some(&draft.id), request.clone(), NoteGroupTarget::Named { title: " 数字电路复习 ".into() },
        ).unwrap();
        assert_eq!(saved.id, draft.id);
        assert_eq!(saved.parent_id.as_deref(), Some(group.id.as_str()));
        assert_eq!(saved.sort_order, chapter.sort_order + 1);
        assert_eq!(store.list_notes().unwrap().len(), 3);
        assert_eq!(store.read_note(&saved.id).unwrap().content, "章末小结");

        let error = store.save_grouped_note(
            Some(&group.id), request.clone(), NoteGroupTarget::Existing { id: saved.id.clone() },
        ).unwrap_err();
        assert_eq!(error.code, "invalidNoteMove");
        let ungrouped = store.save_grouped_note(Some(&saved.id), request, NoteGroupTarget::Root).unwrap();
        assert_eq!(ungrouped.parent_id, None);
    }

    #[test]
    fn simultaneous_notes_using_the_same_new_group_share_one_parent() {
        let store = NoteStore::new(test_root("group-shared"));
        let save = || store.save_grouped_note(
            None,
            SaveNoteRequest { title: String::new(), content: "随手记".into(), parent_id: None },
            NoteGroupTarget::Named { title: "学习笔记".into() },
        ).unwrap();
        let (first, second) = std::thread::scope(|threads| {
            let first = threads.spawn(&save);
            let second = threads.spawn(&save);
            (first.join().unwrap(), second.join().unwrap())
        });
        assert_ne!(first.id, second.id);
        assert_eq!(first.parent_id, second.parent_id);
        assert_eq!(store.read_note(first.parent_id.as_deref().unwrap()).unwrap().title, "学习笔记");
        assert_eq!(store.list_notes().unwrap().len(), 3);
    }

    #[test]
    fn creates_updates_reads_and_deletes_markdown_notes() {
        let store = NoteStore::new(test_root("crud"));

        let created = store
            .create_note(SaveNoteRequest {
                title: "A/B:Test".into(),
                content: "hello\nworld".into(),
                parent_id: None,
            })
            .expect("create note");

        assert_eq!(created.title, "A/B:Test");
        assert_eq!(created.content, "hello\nworld");
        assert_eq!(created.word_count, 10);
        assert!(created.file_name.ends_with(".md"));
        assert!(created.file_name.contains("A_B_Test"));

        let loaded = store.read_note(&created.id).expect("read note");
        assert_eq!(loaded, created);

        let listed = store.list_notes().expect("list notes");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.id);
        assert_eq!(listed[0].preview, "hello world");

        let updated = store
            .update_note(
                &created.id,
                SaveNoteRequest {
                    title: "".into(),
                    content: "# 新标题\nsecond line".into(),
                    parent_id: None,
                },
            )
            .expect("update note");

        assert_eq!(updated.title, "");
        assert_eq!(updated.content, "# 新标题\nsecond line");
        assert_ne!(updated.file_name, created.file_name);

        store.delete_note(&created.id).expect("delete note");
        assert!(store.read_note(&created.id).is_err());
        assert!(store.list_notes().expect("list after delete").is_empty());
    }

    #[test]
    fn keeps_sidebar_icons_across_content_updates_and_store_reloads() {
        let root = test_root("note-icon");
        let store = NoteStore::new(root.clone());
        let note = store.create_note(SaveNoteRequest {
            title: "原标题".into(),
            content: "原正文".into(),
            parent_id: None,
        }).unwrap();
        let icon = Some(NoteIcon::Emoji("👩🏽‍💻".into()));
        store.set_note_icon(&note.id, icon.clone()).unwrap();
        let with_icon = store.read_note(&note.id).unwrap();
        assert_eq!(with_icon.icon, icon);
        assert_eq!(with_icon.updated_at, note.updated_at);
        assert_eq!(with_icon.content, note.content);

        let reloaded = NoteStore::new(root);
        assert_eq!(reloaded.list_notes().unwrap()[0].icon, icon);
        let updated = reloaded.update_note(&note.id, SaveNoteRequest {
            title: "新标题".into(),
            content: "新正文".into(),
            parent_id: None,
        }).unwrap();
        assert_eq!(updated.icon, icon);

        let malformed = Some(NoteIcon::Image("bad png".into()));
        assert_eq!(reloaded.set_note_icon(&note.id, malformed).unwrap_err().code, "invalidNoteIcon");
        assert_eq!(reloaded.read_note(&note.id).unwrap().icon, icon);

        let image = Some(NoteIcon::Image(concat!(
            "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAY0lEQVR4nO3PMQ0AIBDAQFQhEOOPCIYLSYfu17XPzM8tDWhAAx",
            "rQgAY0oAENaEADGtCABjSgAQ1oQAMa0IAGNKABDWhAAxrQgAY0oAENaEADGtCABjSgAQ1oQAMa0IAGNOC1C8bOZ2lrsraoAAAAAElFTkSuQmCC"
        ).into()));
        reloaded.set_note_icon(&note.id, image.clone()).unwrap();
        assert_eq!(store.read_note(&note.id).unwrap().icon, image);
        reloaded.set_note_icon(&note.id, None).unwrap();
        assert_eq!(store.read_note(&note.id).unwrap().icon, None);
    }

    #[test]
    fn moves_relative_to_the_target_with_duplicate_orders_and_nested_notes() {
        use NoteDropPosition::{After, Before, Inside};

        let store = NoteStore::new(test_root("relative-note-move"));
        let create = |title: &str, parent_id: Option<String>| {
            store.create_note(SaveNoteRequest {
                title: title.into(),
                content: String::new(),
                parent_id,
            }).unwrap()
        };
        let first = create("First", None);
        let second = create("Second", None);
        let third = create("Third", None);
        let child = create("Child", Some(first.id.clone()));
        store.reorder_notes(vec![first.id.clone(), second.id.clone()].into_iter().map(|id| {
            NoteReorderEntry { id, sort_order: 0 }
        }).collect()).unwrap();

        store.move_note(&third.id, &second.id, After).unwrap();
        let order = |id: &str| store.read_note(id).unwrap().sort_order;
        assert_eq!(order(&third.id), order(&second.id) + 1);

        store.move_note(&second.id, &first.id, Inside).unwrap();
        assert_eq!(store.read_note(&second.id).unwrap().parent_id.as_deref(), Some(first.id.as_str()));
        assert_eq!(order(&second.id), order(&child.id) + 1);
        assert_eq!(store.move_note(&first.id, &child.id, Before).unwrap_err().code, "invalidNoteMove");

        store.move_note(&child.id, &first.id, Before).unwrap();
        assert_eq!(store.read_note(&child.id).unwrap().parent_id, None);
        assert_eq!(order(&child.id) + 1, order(&first.id));
    }

    #[test]
    fn rebuilds_metadata_when_metadata_json_is_corrupt() {
        let store = NoteStore::new(test_root("repair"));
        let first = store
            .create_note(SaveNoteRequest {
                title: "第一条".into(),
                content: "# 第一条\n正文".into(),
                parent_id: None,
            })
            .expect("create first");
        let second = store
            .create_note(SaveNoteRequest {
                title: "第二条".into(),
                content: "第二条正文".into(),
                parent_id: None,
            })
            .expect("create second");

        fs::write(store.metadata_path(), "{ broken json").expect("corrupt metadata");

        let repaired = store.list_notes().expect("repair metadata");
        let ids: Vec<_> = repaired.iter().map(|note| note.id.as_str()).collect();

        assert_eq!(repaired.len(), 2);
        assert!(ids.contains(&first.id.as_str()));
        assert!(ids.contains(&second.id.as_str()));
        assert!(store
            .base_dir()
            .read_dir()
            .expect("read base dir")
            .any(|entry| entry
                .expect("entry")
                .file_name()
                .to_string_lossy()
                .starts_with("metadata.corrupt-")));
    }

    #[test]
    fn reads_and_writes_config_json() {
        let store = NoteStore::new(test_root("config"));

        let default_config = store.load_config().expect("load default config");
        assert_eq!(default_config.global_shortcut, "Ctrl+Space");
        assert!(default_config.note_auto_save);
        assert!(default_config.note_surface_auto_save);
        assert_eq!(default_config.tile_color, "#f6f3ec");
        assert_eq!(default_config.tile_color_mode, "system");
        assert_eq!(default_config.theme, "system");
        assert!(default_config.notes_dir.ends_with(r"\notes"));

        let custom_notes_dir = store.base_dir().join("custom-notes");
        let saved = AppConfig {
            notes_dir: custom_notes_dir.to_string_lossy().to_string(),
            global_shortcut: "Alt+Space".into(),
            close_to_tray: false,
            autostart: true,
            default_view_mode: "preview".into(),
            note_auto_save: false,
            note_surface_auto_save: false,
            tile_color: "#efe8dc".into(),
            tile_color_mode: "custom".into(),
            theme: "dark".into(),
            font_size: 16,
            surface_font_size: 16,
        };

        store.save_config(saved.clone()).expect("save config");

        let loaded = store.load_config().expect("reload config");
        assert_eq!(loaded, saved);
        assert!(custom_notes_dir.exists());
    }

    #[test]
    fn loads_legacy_config_with_note_surface_auto_save_enabled() {
        let store = NoteStore::new(test_root("legacy-config"));
        let notes_dir = store.base_dir().join("notes");
        fs::create_dir_all(&notes_dir).expect("create notes dir");
        fs::write(
            store.config_path(),
            format!(
                r#"{{
  "notesDir": "{}",
  "globalShortcut": "Ctrl+Space",
  "closeToTray": true,
  "autostart": false,
  "defaultViewMode": "split"
}}"#,
                notes_dir.to_string_lossy().replace('\\', "\\\\")
            ),
        )
        .expect("write legacy config");

        let loaded = store.load_config().expect("load legacy config");

        assert!(loaded.note_auto_save);
        assert!(loaded.note_surface_auto_save);
        assert_eq!(loaded.tile_color, "#f6f3ec");
        assert_eq!(loaded.tile_color_mode, "system");
        assert_eq!(loaded.theme, "system");
        assert_eq!(loaded.font_size, 14);
        assert_eq!(loaded.surface_font_size, 14);
    }

    #[test]
    fn imports_markdown_heading_title_without_stripping_content() {
        let root = test_root("import-heading-title");
        let source_path = root.join("外部文件.md");
        let source_content = "# 导入标题\n正文第一行\n正文第二行";
        fs::write(&source_path, source_content).expect("write source markdown");
        let store = NoteStore::new(root.join("store"));

        let imported = store
            .import_markdown_file(&source_path)
            .expect("import markdown");

        assert_eq!(imported.title, "导入标题");
        assert_eq!(imported.content, source_content);
        assert_eq!(store.read_note(&imported.id).expect("read imported").content, source_content);
    }

    #[test]
    fn imports_markdown_title_from_file_name_without_heading() {
        let root = test_root("import-file-title");
        let source_path = root.join("会议记录.md");
        let source_content = "正文第一行\n# 不是第一行标题";
        fs::write(&source_path, source_content).expect("write source markdown");
        let store = NoteStore::new(root.join("store"));

        let imported = store
            .import_markdown_file(&source_path)
            .expect("import markdown");

        assert_eq!(imported.title, "会议记录");
        assert_eq!(imported.content, source_content);
    }

    #[test]
    fn exports_markdown_file_without_rewriting_content() {
        let root = test_root("export-markdown");
        let store = NoteStore::new(root.join("store"));
        let content = "# 原始标题\n正文\n- 列表";
        let note = store
            .create_note(SaveNoteRequest {
                title: "导出标题".into(),
                content: content.into(),
                parent_id: None,
            })
            .expect("create note");
        let export_path = root.join("exports").join("导出.md");

        store
            .export_markdown_file(&note.id, &export_path)
            .expect("export markdown");

        assert_eq!(
            fs::read_to_string(export_path).expect("read exported markdown"),
            content
        );
    }
}
