use keyring::Entry;

fn main() {
    println!("Testing keyring functionality...");
    
    let service = "com.kobozo.jaterm";
    let account = "data-encryption-key-v1";
    let test_password = "test-dek-value-base64";
    
    println!("Service: {}", service);
    println!("Account: {}", account);
    
    // Try to create entry
    match Entry::new(service, account) {
        Ok(entry) => {
            println!("✅ Successfully created Entry object");
            
            // Try to set password
            match entry.set_password(test_password) {
                Ok(_) => println!("✅ Successfully stored password in keychain"),
                Err(e) => {
                    println!("❌ Failed to store password: {}", e);
                    println!("Error details: {:?}", e);
                }
            }
            
            // Try to retrieve it back
            match entry.get_password() {
                Ok(retrieved) => {
                    if retrieved == test_password {
                        println!("✅ Successfully retrieved password from keychain");
                    } else {
                        println!("❌ Retrieved password doesn't match");
                    }
                }
                Err(e) => {
                    println!("❌ Failed to retrieve password: {}", e);
                    println!("Error details: {:?}", e);
                }
            }
            
            // Clean up
            match entry.delete_credential() {
                Ok(_) => println!("✅ Successfully deleted test entry"),
                Err(e) => println!("⚠️ Failed to delete test entry: {}", e),
            }
        }
        Err(e) => {
            println!("❌ Failed to create Entry: {}", e);
            println!("Error details: {:?}", e);
        }
    }
}