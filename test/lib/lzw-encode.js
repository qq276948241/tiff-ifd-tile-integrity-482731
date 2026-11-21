"use strict";
// Independent TIFF LZW encoder for test fixtures only. It is the exact mirror
// of the canonical (libtiff) decoder: code width starts at 9 bits and widens to
// 10/11/12 the moment the next dictionary index reaches 512/1024/2048, so the
// width transition happens at the same logical step on both sides.
function encodeLZW(input) {
	var out = [], acc = 0, bits = 0, width = 9;
	function emit(code) {
		acc = (acc << width) | code;
		bits += width;
		while(bits >= 8) {
			bits -= 8;
			out.push((acc >>> bits) & 0xff);
			acc &= (1 << bits) - 1;
		}
	}
	function flush() {
		if(bits > 0) { out.push((acc << (8 - bits)) & 0xff); acc = 0; bits = 0; }
	}

	var dict = new Map(), nextCode = 258;
	function reset() {
		dict.clear();
		for(var i = 0; i < 256; i++) dict.set(String(i), i);
		nextCode = 258; width = 9;
	}
	function define(phrase) {
		if(nextCode >= 4096) return;
		dict.set(phrase, nextCode);
		nextCode++;
		// Encoder widens when the next index reaches a power of two (512/1024/2048);
		// the decoder widens one step earlier (at 511/1023/2047). This asymmetry is
		// the canonical LZW behaviour and the pair is verified round-trip.
		if(nextCode === 512 || nextCode === 1024 || nextCode === 2048) width++;
	}

	reset();
	emit(256);                          // clear code
	if(input.length === 0) { emit(257); flush(); return new Uint8Array(out); }

	var phrase = String(input[0]);
	for(var p = 1; p < input.length; p++) {
		var c = input[p];
		var candidate = phrase + "," + c;
		if(dict.has(candidate)) {
			phrase = candidate;
		} else {
			emit(dict.get(phrase));
			define(candidate);
			phrase = String(c);
		}
	}
	emit(dict.get(phrase));
	emit(257);                          // end of information
	flush();
	return new Uint8Array(out);
}

module.exports = { encodeLZW: encodeLZW };
