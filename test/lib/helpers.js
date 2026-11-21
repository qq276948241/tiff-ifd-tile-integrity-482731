"use strict";
// Hand-computed pixel references and shared assertion helpers. References are
// expressed as explicit per-pixel formulas with literal anchor expectations,
// never derived from the decoder under test.
var assert = require("assert");
var path = require("path");
var UTIF = require(path.join(__dirname, "..", "..", "UTIF.js"));
var Writer = require(path.join(__dirname, "tiff-writer.js")).Writer;

// Deterministic 8-bit sample: v(x,y,channel) = (a*x + b*y + c*channel + k) mod 256.
function sample8(x, y, ch, w, h) {
	return (37*x + 71*y + 11*ch + 5) & 255;
}
// Deterministic 16-bit sample spanning the full range.
function sample16(x, y, ch) {
	return ((x*4999 + y*1031 + ch*7919 + 17) & 0xffff) >>> 0;
}
function gray8(w, h) {
	var p = new Uint8Array(w*h);
	for(var y=0;y<h;y++) for(var x=0;x<w;x++) p[y*w+x] = sample8(x,y,0,w,h);
	return p;
}
function rgb8(w, h) {
	var p = new Uint8Array(w*h*3);
	for(var y=0;y<h;y++) for(var x=0;x<w;x++) for(var c=0;c<3;c++)
		p[(y*w+x)*3+c] = sample8(x,y,c,w,h);
	return p;
}
function rgba8(w, h) {
	var p = new Uint8Array(w*h*4);
	for(var y=0;y<h;y++) for(var x=0;x<w;x++) {
		for(var c=0;c<3;c++) p[(y*w+x)*4+c] = sample8(x,y,c,w,h);
		p[(y*w+x)*4+3] = ((x*13+y*29)&255);   // hand-set alpha
	}
	return p;
}
function gray16(w, h) {
	var p = new Uint8Array(w*h*2);
	for(var y=0;y<h;y++) for(var x=0;x<w;x++) {
		var v = sample16(x,y,0);
		p[(y*w+x)*2]   = v & 255;        // little-endian on disk
		p[(y*w+x)*2+1] = (v >>> 8) & 255;
	}
	return p;
}
function rgb16(w, h) {
	var p = new Uint8Array(w*h*3*2);
	for(var y=0;y<h;y++) for(var x=0;x<w;x++) for(var c=0;c<3;c++) {
		var v = sample16(x,y,c);
		p[((y*w+x)*3+c)*2]   = v & 255;
		p[((y*w+x)*3+c)*2+1] = (v >>> 8) & 255;
	}
	return p;
}

// Expected 8-bit RGBA for an 8-bit grayscale (photometric 1) image.
function expectedGrayRGBA8(w, h) {
	var out = new Uint8Array(w*h*4);
	for(var y=0;y<h;y++) for(var x=0;x<w;x++) {
		var v = sample8(x,y,0,w,h), i=(y*w+x)*4;
		out[i]=out[i+1]=out[i+2]=v; out[i+3]=255;
	}
	return out;
}
// Fixed full-range 16->8 scaling rule under test: round(v*255/65535).
function scale16(v) { return Math.round(v*255/65535); }

function buildOne(w, h, px, opts, le) {
	return new Writer(le !== false).addPage(w, h, px, opts).build();
}
function decodeFirst(buff) {
	var ifds = UTIF.decode(buff);
	UTIF.decodeImage(buff, ifds[0]);
	return ifds[0];
}
function assertRGBA(actual, expected, msg) {
	assert.strictEqual(actual.length, expected.length, (msg||"") + " length");
	for(var i=0;i<expected.length;i++) {
		assert.strictEqual(actual[i], expected[i], (msg||"rgba") + " byte " + i);
	}
}
function expectTiffError(fn, code, msg) {
	try { fn(); }
	catch(e) {
		assert.ok(e instanceof UTIF.TiffError, (msg||code) + " expected TiffError, got " + e);
		assert.strictEqual(e.code, code, (msg||"") + " expected code " + code + " got " + e.code);
		return;
	}
	assert.fail((msg||code) + " expected TiffError(" + code + ") but nothing was thrown");
}

module.exports = {
	UTIF: UTIF, Writer: Writer, assert: assert,
	sample8: sample8, sample16: sample16,
	gray8: gray8, rgb8: rgb8, rgba8: rgba8, gray16: gray16, rgb16: rgb16,
	expectedGrayRGBA8: expectedGrayRGBA8, scale16: scale16,
	buildOne: buildOne, decodeFirst: decodeFirst,
	assertRGBA: assertRGBA, expectTiffError: expectTiffError
};
