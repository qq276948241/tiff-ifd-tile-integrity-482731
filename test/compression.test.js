"use strict";
// LZW / PackBits compressor hardening. These exercise dictionary width
// transitions (9->10->11->12 bits), the KwKw edge case, saturation and a wide
// range of patterns, all checked against the independently encoded fixtures.
var test = require("node:test");
var H = require("./lib/helpers");
var UTIF = H.UTIF, assert = H.assert;
var lzwEnc = require("./lib/lzw-encode.js").encodeLZW;
var packEnc = require("./lib/packbits-encode.js").encodePackBits;

function pattern(t, len) {
	var a = new Uint8Array(len), mode = t % 5;
	for(var i=0;i<len;i++) {
		if(mode===0) a[i] = i & 255;                    // gradient
		else if(mode===1) a[i] = (i*i + 7) & 255;       // quadratic
		else if(mode===2) a[i] = (i % 7) * 36;          // repetitive runs
		else if(mode===3) a[i] = ((i*131 + t) & 0xffff) >> 4 & 255;  // pseudo-random
		else a[i] = i % 3 === 0 ? 200 : (i & 255);      // mixed
	}
	return a;
}

test("LZW round-trips across all dictionary width transitions", function() {
	for(var t=0; t<60; t++) {
		var len = 300 + ((t*211) % 5000);   // large enough to cross 512/1024/2048
		var input = pattern(t, len);
		var enc = lzwEnc(input);
		var tgt = new Uint8Array(len);
		var n = UTIF.decode._decodeLZW(enc, 0, enc.length, tgt, 0, 8, len);
		assert.strictEqual(n, len, "produced length t=" + t);
		for(var k=0;k<len;k++) assert.strictEqual(tgt[k], input[k], "byte t=" + t + " k=" + k);
	}
});

test("LZW handles saturation, single-byte and empty inputs", function() {
	var cases = [
		new Uint8Array(0),
		new Uint8Array([7]),
		Uint8Array.from(new Array(3000).fill(42)),
		Uint8Array.from(new Array(5000).map(function(_,i){ return (i*61+3)&255; }))
	];
	cases.forEach(function(input, idx) {
		var enc = lzwEnc(input);
		var tgt = new Uint8Array(input.length);
		var n = UTIF.decode._decodeLZW(enc, 0, enc.length, tgt, 0, 8, input.length);
		assert.strictEqual(n, input.length, "case " + idx + " length");
		for(var k=0;k<input.length;k++) assert.strictEqual(tgt[k], input[k], "case " + idx + " byte " + k);
	});
});

test("LZW cannot write past a deliberately undersized target", function() {
	var input = pattern(3, 400);
	var enc = lzwEnc(input);
	var small = new Uint8Array(100);
	H.expectTiffError(function(){
		UTIF.decode._decodeLZW(enc, 0, enc.length, small, 0, 8, small.length);
	}, "DECOMPRESS_OVERFLOW");
});

test("PackBits independently round-trips through the decoder", function() {
	for(var t=0; t<20; t++) {
		var input = pattern(t, 200 + (t*53) % 800);
		var enc = packEnc(input);
		var tgt = new Uint8Array(input.length);
		var n = UTIF.decode._decodePackBits(enc, 0, enc.length, tgt, 0, input.length);
		assert.strictEqual(n, input.length, "packbits length t=" + t);
		for(var k=0;k<input.length;k++) assert.strictEqual(tgt[k], input[k], "packbits t=" + t);
	}
});
