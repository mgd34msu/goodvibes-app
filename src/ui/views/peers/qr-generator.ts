// Local mirror of the pinned goodvibes SDK's "platform" pairing qr-generator
// module — same algorithm, same output shape ({size, modules}), over the
// vendored qrcodegen-vendor.ts in this same directory. See that file's
// docblock for why this is duplicated rather than imported: scripts/
// check-boundaries.ts forbids every import of that SDK's "platform"
// subpath from src/ui.

import { qrcodegen } from "./qrcodegen-vendor.ts";

export interface QrMatrix {
  readonly size: number;
  readonly modules: readonly boolean[][];
}

const QrCodeClass = qrcodegen.QrCode;
const Ecc = QrCodeClass.Ecc;

/** Generate a QR code matrix for the given data string (medium error correction, matching the SDK original). */
export function generateQrMatrix(data: string): QrMatrix {
  const qr = QrCodeClass.encodeText(data, Ecc.MEDIUM);
  const size: number = qr.size;
  const modules: boolean[][] = [];
  for (let row = 0; row < size; row++) {
    const rowData: boolean[] = [];
    for (let col = 0; col < size; col++) {
      rowData.push(qr.getModule(col, row));
    }
    modules.push(rowData);
  }
  return { size, modules };
}
