class IFFReader {
  constructor(arrayBuffer) {
    this.view = new DataView(arrayBuffer);
    this.offset = 0;
    this.formStack = [];
  }

  readTag() {
    const tag = String.fromCharCode(
      this.view.getUint8(this.offset),
      this.view.getUint8(this.offset + 1),
      this.view.getUint8(this.offset + 2),
      this.view.getUint8(this.offset + 3)
    );
    this.offset += 4;
    return tag;
  }

  readInt32() {
    const value = this.view.getInt32(this.offset, true); // little-endian
    this.offset += 4;
    return value;
  }

  readFloat() {
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readVector() {
    return {
      x: this.readFloat(),
      y: this.readFloat(),
      z: this.readFloat()
    };
  }

  readString(maxLength) {
    let str = '';
    for (let i = 0; i < maxLength; i++) {
      const char = this.view.getUint8(this.offset++);
      if (char === 0) break;
      str += String.fromCharCode(char);
    }
    return str;
  }

  enterForm(expectedTag = null) {
    const tag = this.readTag();
    const size = this.readInt32();
    this.formStack.push({ tag, endOffset: this.offset + size });

    if (expectedTag && tag !== expectedTag) {
      console.warn(`Expected form ${expectedTag}, got ${tag}`);
    }
    return tag;
  }

  exitForm() {
    if (this.formStack.length > 0) {
      const form = this.formStack.pop();
      this.offset = form.endOffset;
    }
  }

  enterChunk(expectedTag = null) {
    const tag = this.readTag();
    const size = this.readInt32();

    if (expectedTag && tag !== expectedTag) {
      console.warn(`Expected chunk ${expectedTag}, got ${tag}`);
    }
    return { tag, size, endOffset: this.offset + size };
  }

  exitChunk(chunk) {
    this.offset = chunk.endOffset;
  }
}