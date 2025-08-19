use std::{fs, path::Path, fs::File, io::BufWriter, env, process::Command};
use image::{ImageEncoder, GenericImageView}; // write_image + size helpers

fn is_rgba8_png(path: &Path) -> bool {
  match File::open(path) {
    Ok(file) => {
      let decoder = match png::Decoder::new(file).read_info() {
        Ok(reader) => reader,
        Err(_) => return false,
      };
      let info = decoder.info();
      info.color_type == png::ColorType::Rgba && info.bit_depth == png::BitDepth::Eight
    }
    Err(_) => false,
  }
}

fn ensure_icon() {
  let icon_dir = Path::new("icons");
  let icon_path = icon_dir.join("icon.png");
  let _ = fs::create_dir_all(icon_dir);

  if icon_path.exists() {
    // Only re-encode if not already RGBA8 to avoid rebuild loops
    if is_rgba8_png(&icon_path) {
      return;
    }
    // Force-reencode existing icon as RGBA8 PNG so Tauri accepts it
    match image::open(&icon_path) {
      Ok(img) => {
        let (w, h) = img.dimensions();
        let rgba = img.to_rgba8();
        let file = File::create(&icon_path).expect("rewrite icon.png as RGBA");
        let mut writer = BufWriter::new(file);
        let encoder = image::codecs::png::PngEncoder::new(&mut writer);
        use image::ColorType;
        encoder
          .write_image(&rgba, w, h, ColorType::Rgba8.into())
          .expect("encode rgba png");
      }
      Err(_) => {
        // If unreadable, fall back to a tiny transparent placeholder
        let w = 64u32;
        let h = 64u32;
        let buf = vec![0u8; (w * h * 4) as usize];
        let file = File::create(&icon_path).expect("create fallback icon.png");
        let mut writer = BufWriter::new(file);
        let encoder = image::codecs::png::PngEncoder::new(&mut writer);
        use image::ColorType;
        encoder
          .write_image(&buf, w, h, ColorType::Rgba8.into())
          .expect("encode fallback rgba png");
      }
    }
  } else {
    // Create a small 64x64 RGBA PNG (solid transparent)
    let w = 64u32;
    let h = 64u32;
    let buf = vec![0u8; (w * h * 4) as usize]; // RGBA zeros => transparent
    let file = File::create(&icon_path).expect("create icon.png");
    let mut writer = BufWriter::new(file);
    let encoder = image::codecs::png::PngEncoder::new(&mut writer);
    use image::ColorType;
    encoder
      .write_image(&buf, w, h, ColorType::Rgba8.into())
      .expect("encode rgba png");
  }
}

fn build_helper_binary() {
  println!("cargo:rerun-if-changed=../src-helper/src");
  println!("cargo:rerun-if-changed=../src-helper/Cargo.toml");
  
  // Build the native helper binary
  let output = Command::new("cargo")
    .args(&["build", "--release"])
    .current_dir("../src-helper")
    .output()
    .expect("Failed to build helper binary");
  
  if !output.status.success() {
    panic!("Failed to build helper binary: {}", String::from_utf8_lossy(&output.stderr));
  }
  
  println!("cargo:warning=Built native helper binary successfully");
  
  // Also build Linux binary if cargo-zigbuild is available and we're on macOS
  if cfg!(target_os = "macos") {
    if let Ok(output) = Command::new("which")
      .arg("cargo-zigbuild")
      .output() {
      if output.status.success() {
        println!("cargo:warning=Building Linux helper binary with cargo-zigbuild...");
        let output = Command::new("cargo")
          .args(&["zigbuild", "--release", "--target", "x86_64-unknown-linux-gnu"])
          .current_dir("../src-helper")
          .output()
          .expect("Failed to build Linux helper binary");
        
        if !output.status.success() {
          println!("cargo:warning=Failed to build Linux helper binary: {}", String::from_utf8_lossy(&output.stderr));
        } else {
          println!("cargo:warning=Built Linux helper binary successfully");
        }
      }
    }
  }
}

fn generate_helper_module() {
  // Tell cargo to re-run this script if the helper version changes
  println!("cargo:rerun-if-changed=../src-helper/src/version.rs");
  
  // Read the version from the Rust helper
  let version_path = Path::new("../src-helper/src/version.rs");
  let version_content = fs::read_to_string(version_path)
    .expect("Failed to read helper version file");
  
  // Extract version from Rust file
  let version = version_content
    .lines()
    .find(|line| line.contains("pub const HELPER_VERSION"))
    .and_then(|line| {
      line.split('"')
        .nth(1)
    })
    .expect("Failed to extract HELPER_VERSION");
  
  // Read the native helper binary
  let helper_binary_path = if cfg!(target_os = "windows") {
    Path::new("../src-helper/target/release/jaterm-agent.exe")
  } else {
    Path::new("../src-helper/target/release/jaterm-agent")
  };
  
  let helper_binary = fs::read(helper_binary_path)
    .expect("Failed to read helper binary - run 'cargo build --release' in src-helper first");
  
  // Try to read Linux binary if it exists
  let linux_binary_path = Path::new("../src-helper/target/x86_64-unknown-linux-gnu/release/jaterm-agent");
  let linux_binary = if linux_binary_path.exists() {
    fs::read(linux_binary_path).ok()
  } else {
    None
  };
  
  // Write the helper module with embedded binary/binaries
  let out_dir = env::var("OUT_DIR").unwrap();
  let dest_path = Path::new(&out_dir).join("helper_generated.rs");
  
  let rust_code = if let Some(linux_bin) = linux_binary {
    format!(
      r#"pub const HELPER_VERSION: &str = "{}";
pub const HELPER_NAME: &str = "jaterm-agent";
pub const HELPER_REL_DIR: &str = ".jaterm-helper";
pub const HELPER_BINARY: &[u8] = &{:?};
pub const HELPER_BINARY_LINUX: &[u8] = &{:?};
"#,
      version,
      helper_binary,
      linux_bin
    )
  } else {
    format!(
      r#"pub const HELPER_VERSION: &str = "{}";
pub const HELPER_NAME: &str = "jaterm-agent";
pub const HELPER_REL_DIR: &str = ".jaterm-helper";
pub const HELPER_BINARY: &[u8] = &{:?};
"#,
      version,
      helper_binary
    )
  };
  
  fs::write(&dest_path, rust_code)
    .expect("Failed to write generated helper module");
  
  println!("cargo:warning=Embedded helper binary version {}", version);
  if linux_binary_path.exists() {
    println!("cargo:warning=Also embedded Linux helper binary");
  }
}

fn main() {
  ensure_icon();
  build_helper_binary();
  generate_helper_module();
  tauri_build::build()
}