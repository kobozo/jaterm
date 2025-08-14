use std::{fs, path::Path, fs::File, io::BufWriter};
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

fn main() {
  ensure_icon();
  tauri_build::build()
}
