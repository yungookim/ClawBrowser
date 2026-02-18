use std::collections::HashMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabInfo {
    pub id: String,
    pub url: String,
    pub title: String,
}

pub struct TabState {
    pub tabs: HashMap<String, TabInfo>,
    pub active_tab: Option<String>,
    pub chrome_height: f64,
}

impl TabState {
    pub fn new() -> Self {
        Self {
            tabs: HashMap::new(),
            active_tab: None,
            chrome_height: 80.0,
        }
    }
}
