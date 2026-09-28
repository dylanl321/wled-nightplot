import { createSocket, type Socket } from "node:dgram";

/** DDP header: version 1 + push, RGB, default id. Offset is bytes. */
export const DDP_HEADER_SIZE = 10;
export const DDP_TYPE_RGB = 0x01;
export const DDP_FLAGS_PUSH_V1 = 0x41;

export type DdpPacket = {
  offsetBytes: number;
  rgb: Uint8Array;
};

export function encodeDdpRgb(rgb: Uint8Array, offsetBytes = 0, sequence = 0): Buffer {
  const header = Buffer.alloc(DDP_HEADER_SIZE);
  header[0] = DDP_FLAGS_PUSH_V1;
  header[1] = sequence & 0xff;
  header[2] = DDP_TYPE_RGB;
  header[3] = 0x01;
  header.writeUInt32BE(offsetBytes >>> 0, 4);
  header.writeUInt16BE(rgb.length, 8);
  return Buffer.concat([header, Buffer.from(rgb)]);
}

export function parseDdpRgb(message: Buffer): DdpPacket | null {
  if (message.length < DDP_HEADER_SIZE) return null;
  const type = message[2] ?? 0;
  if ((type & 0x3f) !== DDP_TYPE_RGB) return null;
  const offsetBytes = message.readUInt32BE(4);
  const length = message.readUInt16BE(8);
  if (length < 0 || message.length < DDP_HEADER_SIZE + length) return null;
  return {
    offsetBytes,
    rgb: Uint8Array.from(message.subarray(DDP_HEADER_SIZE, DDP_HEADER_SIZE + length)),
  };
}

export function listenDdp(
  port: number,
  onPixels: (offsetBytes: number, rgb: Uint8Array) => void,
  hostname = "127.0.0.1",
): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const socket: Socket = createSocket("udp4");
    socket.on("error", reject);
    socket.on("message", (message) => {
      const packet = parseDdpRgb(message);
      if (!packet) return;
      onPixels(packet.offsetBytes, packet.rgb);
    });
    socket.bind(port, hostname, () => {
      socket.off("error", reject);
      const addr = socket.address();
      const bound = typeof addr === "object" ? addr.port : port;
      resolve({
        port: bound,
        close: () =>
          new Promise((done) => {
            socket.close(() => done());
          }),
      });
    });
  });
}

export function sendDdpRgb(
  host: string,
  port: number,
  rgb: Uint8Array,
  offsetBytes = 0,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createSocket("udp4");
    const packet = encodeDdpRgb(rgb, offsetBytes);
    socket.send(packet, port, host, (error) => {
      socket.close();
      if (error) reject(error);
      else resolve();
    });
  });
}

export function rgbFill(ledCount: number, r: number, g: number, b: number): Uint8Array {
  const rgb = new Uint8Array(Math.max(0, ledCount) * 3);
  for (let i = 0; i < rgb.length; i += 3) {
    rgb[i] = r;
    rgb[i + 1] = g;
    rgb[i + 2] = b;
  }
  return rgb;
}
