// Decode the rendered pixels, not the generator input. jsQR can reject valid
// dense symbols; ZXing provides an independent decoder for those fixtures.
import jsQR from 'jsqr';
import { RGBLuminanceSource, HybridBinarizer, BinaryBitmap, QRCodeReader } from '@zxing/library';
export function decodeQr(png) {
  const direct = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  if (direct) return direct;
  const gray = new Uint8ClampedArray(png.width * png.height);
  for (let i = 0; i < gray.length; i++) gray[i] = (png.data[i * 4] + 2 * png.data[i * 4 + 1] + png.data[i * 4 + 2]) / 4;
  try {
    const source = new RGBLuminanceSource(gray, png.width, png.height);
    return { data: new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(source))).getText() };
  } catch { return null; }
}
