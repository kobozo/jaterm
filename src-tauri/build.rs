use std::{fs, path::Path, fs::File, io::BufWriter, env};
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

fn generate_helper_module() {
  // Tell cargo to re-run this script if the helper script changes
  println!("cargo:rerun-if-changed=../src/shared/helper-script.sh");
  println!("cargo:rerun-if-changed=../src/shared/helper-constants.ts");
  
  // Read the helper script
  let helper_script_path = Path::new("../src/shared/helper-script.sh");
  let helper_script = fs::read_to_string(helper_script_path)
    .expect("Failed to read helper script");
  
  // Read the version from helper-constants.ts
  let constants_path = Path::new("../src/shared/helper-constants.ts");
  let constants = fs::read_to_string(constants_path)
    .expect("Failed to read helper constants");
  
  // Extract version from TypeScript file
  let version = constants
    .lines()
    .find(|line| line.contains("export const HELPER_VERSION"))
    .and_then(|line| {
      line.split('\'')
        .nth(1)
        .or_else(|| line.split('"').nth(1))
    })
    .expect("Failed to extract HELPER_VERSION");
  
  // Replace placeholder with actual version
  let helper_content = helper_script.replace("HELPER_VERSION_PLACEHOLDER", version);
  
  // Write the processed content to OUT_DIR for inclusion
  let out_dir = env::var("OUT_DIR").unwrap();
  let dest_path = Path::new(&out_dir).join("helper_generated.rs");
  
  // Escape the helper content for Rust string literal
  let escaped_content = helper_content
    .replace('\\', "\\\\")
    .replace('"', "\\\"")
    .replace('\n', "\\n")
    .replace('\r', "\\r")
    .replace('\t', "\\t");
  
  let rust_code = format!(
    r#"pub const HELPER_VERSION: &str = "{}";
pub const HELPER_NAME: &str = "jaterm-agent";
pub const HELPER_REL_DIR: &str = ".jaterm-helper";
pub const HELPER_CONTENT: &str = "{}";
"#,
    version,
    escaped_content
  );
  
  fs::write(&dest_path, rust_code)
    .expect("Failed to write generated helper script");
}

fn main() {
  ensure_icon();
  generate_helper_module();
  tauri_build::build()
}
