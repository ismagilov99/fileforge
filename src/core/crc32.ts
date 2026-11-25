/** Small shared CRC-32 implementation used for PNG IHDR and ZIP integrity checks. */
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let number = 0; number < 256; number += 1) {
    let value = number;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[number] = value >>> 0;
  }
  return table;
})();

export function calculateCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
