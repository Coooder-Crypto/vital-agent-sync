import QRCode from "qrcode";

export type TerminalQrRenderOptions = {
  columns?: number;
  margin?: number;
};

export type TerminalQrRenderResult = {
  rendered: true;
  text: string;
  width: number;
} | {
  rendered: false;
  width: number;
  requiredColumns: number;
};

type QrMatrix = {
  modules: {
    size: number;
    get: (x: number, y: number) => number;
  };
};

export function renderTerminalQr(
  value: string,
  options: TerminalQrRenderOptions = {}
): TerminalQrRenderResult {
  const qr = QRCode.create(value, {
    errorCorrectionLevel: "M"
  }) as QrMatrix;
  const margin = options.margin ?? 2;
  const size = qr.modules.size;
  const width = size + (margin * 2);
  const columns = options.columns ?? process.stdout.columns ?? 80;
  const availableColumns = Math.max(0, columns - 2);

  if (availableColumns > 0 && width > availableColumns) {
    return {
      rendered: false,
      width,
      requiredColumns: width + 2
    };
  }

  const lines: string[] = [];
  for (let y = -margin; y < size + margin; y += 2) {
    let line = "";
    for (let x = -margin; x < size + margin; x += 1) {
      const topLight = !isDark(qr, x, y, size);
      const bottomLight = !isDark(qr, x, y + 1, size);
      line += lightBlockFor(topLight, bottomLight);
    }
    lines.push(` ${line}`);
  }

  return {
    rendered: true,
    text: lines.join("\n"),
    width
  };
}

function isDark(qr: QrMatrix, x: number, y: number, size: number): boolean {
  if (x < 0 || y < 0 || x >= size || y >= size) {
    return false;
  }

  return qr.modules.get(x, y) === 1;
}

function lightBlockFor(top: boolean, bottom: boolean): string {
  if (top && bottom) {
    return "█";
  }

  if (top) {
    return "▀";
  }

  if (bottom) {
    return "▄";
  }

  return " ";
}
