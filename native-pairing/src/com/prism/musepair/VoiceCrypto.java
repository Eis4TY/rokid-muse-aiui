package com.prism.musepair;

import android.util.Base64;
import java.io.*;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;

final class VoiceCrypto {
 private static final int MAX_FRAME = 65536;

 static void run(Socket socket, InputStream in, String key) throws Exception {
  if (key == null || Base64.decode(key, Base64.DEFAULT).length != 16) return;
  byte[] digest = MessageDigest.getInstance("SHA-1").digest(
      (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").getBytes(StandardCharsets.US_ASCII));
  OutputStream out = new BufferedOutputStream(socket.getOutputStream());
  out.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
      + "Sec-WebSocket-Accept: " + Base64.encodeToString(digest, Base64.NO_WRAP) + "\r\n\r\n")
      .getBytes(StandardCharsets.US_ASCII));
  out.flush();
  socket.setSoTimeout(45000);
  socket.setTcpNoDelay(true);

  Noise.CipherState[] ciphers = null;
  try {
   Noise noise = new Noise();
   write(out, 1, noise.message1());
   byte[] input = read(in, out);
   if (input == null || input[0] != 1) return;
   noise.message2(Arrays.copyOfRange(input, 1, input.length));
   byte[] handshake = noise.message3();
   ciphers = noise.split();
   write(out, 1, handshake);
   while ((input = read(in, out)) != null) {
    int operation = input[0];
    if (operation != 2 && operation != 3) throw new IOException("Invalid voice crypto operation");
    byte[] result = ciphers[operation - 2].apply(operation == 2, Noise.EMPTY,
        Arrays.copyOfRange(input, 1, input.length));
    write(out, operation, result);
   }
  } finally {
   if (ciphers != null) for (Noise.CipherState cipher : ciphers) Arrays.fill(cipher.key, (byte) 0);
  }
 }

 private static byte[] read(InputStream stream, OutputStream out) throws IOException {
  DataInputStream in = new DataInputStream(stream);
  ByteArrayOutputStream message = new ByteArrayOutputStream();
  boolean continuing = false;
  while (true) {
   int flags = in.readUnsignedByte();
   int opcode = flags & 15;
   boolean last = (flags & 128) != 0;
   int header = in.readUnsignedByte();
   if ((flags & 112) != 0 || (header & 128) == 0) throw new IOException("Invalid WebSocket flags");
   int lengthCode = header & 127;
   long length = lengthCode;
   if (lengthCode == 126) length = in.readUnsignedShort();
   else if (lengthCode == 127) length = in.readLong();
   if (length < 0 || length > MAX_FRAME) throw new IOException("Invalid WebSocket length");
   boolean control = opcode >= 8;
   if (control && (!last || lengthCode > 125)) throw new IOException("Invalid WebSocket control frame");
   byte[] mask = new byte[4];
   in.readFully(mask);
   byte[] frame = new byte[(int) length];
   in.readFully(frame);
   for (int i = 0; i < frame.length; i++) frame[i] ^= mask[i & 3];
   if (opcode == 8 || opcode == 9) {
    out.write(opcode == 8 ? 0x88 : 0x8a);
    out.write(frame.length);
    out.write(frame);
    out.flush();
    if (opcode == 8) return null;
    continue;
   }
   if (opcode == 10) continue;
   if (opcode != (continuing ? 0 : 2) || message.size() + length > MAX_FRAME)
    throw new IOException("Invalid WebSocket message");
   message.write(frame);
   if (last) {
    if (message.size() == 0) throw new IOException("Empty voice crypto message");
    return message.toByteArray();
   }
   continuing = true;
  }
 }

 private static void write(OutputStream stream, int operation, byte[] bytes) throws IOException {
  DataOutputStream out = new DataOutputStream(stream);
  int length = bytes.length + 1;
  out.writeByte(0x82);
  if (length < 126) out.writeByte(length);
  else if (length <= 65535) { out.writeByte(126); out.writeShort(length); }
  else { out.writeByte(127); out.writeLong(length); }
  out.writeByte(operation);
  out.write(bytes);
  out.flush();
 }
}
