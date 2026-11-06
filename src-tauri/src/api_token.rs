use keyring::{Entry, Error};

const SERVICE: &str = "be.maurodruwel.tunneldash.cloudflare";
const ACCOUNT: &str = "api-token";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|_| "Could not access the OS credential store".into())
}

#[tauri::command]
pub fn read_api_token() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(Error::NoEntry) => Ok(None),
        Err(_) => Err("Could not read the Cloudflare token from the OS credential store".into()),
    }
}

#[tauri::command]
pub fn write_api_token(token: String) -> Result<(), String> {
    let entry = entry()?;
    if token.is_empty() {
        return match entry.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(_) => {
                Err("Could not remove the Cloudflare token from the OS credential store".into())
            }
        };
    }
    entry
        .set_password(&token)
        .map_err(|_| "Could not save the Cloudflare token in the OS credential store".into())
}
