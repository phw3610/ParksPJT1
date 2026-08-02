import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';

/**
 * 같은 파일을 두 번 올리는 것을 막기 위한 지문.
 * 원본 전체를 읽으면 수백 MB짜리 영상에서 너무 비싸므로 앞뒤 일부만 읽는다.
 * 크기가 다르면 지문도 다르므로 크기를 함께 넣는다.
 */
const SAMPLE_BYTES = 128 * 1024;

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * 실패해도 업로드를 막지 않는다. null이면 중복 검사를 건너뛰고 그냥 올린다.
 */
export async function computeQuickHash(
  fileUri: string,
  byteSize: number,
): Promise<string | null> {
  if (byteSize <= 0) return null;

  let handle: ReturnType<File['open']> | null = null;
  try {
    handle = new File(fileUri).open();

    const head = handle.readBytes(Math.min(SAMPLE_BYTES, byteSize));

    // 앞부분만 보면 같은 카메라로 찍은 사진끼리 헤더가 겹칠 수 있어 뒷부분도 섞는다.
    let tail = new Uint8Array(0);
    if (byteSize > SAMPLE_BYTES * 2) {
      handle.offset = byteSize - SAMPLE_BYTES;
      tail = handle.readBytes(SAMPLE_BYTES);
    }

    const sample = new Uint8Array(head.length + tail.length);
    sample.set(head, 0);
    sample.set(tail, head.length);

    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, sample);
    return `${byteSize}-${toHex(new Uint8Array(digest))}`;
  } catch (error) {
    console.warn('[quick-hash] 파일 지문을 만들지 못했습니다.', error);
    return null;
  } finally {
    handle?.close();
  }
}
