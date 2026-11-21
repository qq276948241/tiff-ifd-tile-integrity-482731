"use strict";
// IFD / directory-level boundary checks: endianness, chained IFDs, OOB offsets,
// circular directories, unknown tag types, truncated values, EXIF-only pages.
var test = require("node:test");
var H = require("./lib/helpers");
var UTIF = H.UTIF, Writer = H.Writer, assert = H.assert, expectTiffError = H.expectTiffError;

test("decodes both little- and big-endian headers in directory order", function() {
	var px = H.gray8(4, 3);
	[true, false].forEach(function(le) {
		var buff = new Writer(le).addPage(4, 3, px, { photometric: 1 }).build();
		var ifds = UTIF.decode(buff);
		assert.strictEqual(ifds.length, 1);
		assert.strictEqual(ifds[0].t256[0], 4);
		assert.strictEqual(ifds[0].t257[0], 3);
	});
});

test("multi-page files return IFDs in chained directory order", function() {
	var a = H.gray8(3, 2), b = H.gray8(5, 4), c = H.gray8(2, 2);
	var buff = new Writer(true)
		.addPage(3, 2, a, { photometric: 1 })
		.addPage(5, 4, b, { photometric: 1 })
		.addPage(2, 2, c, { photometric: 1 }).build();
	var ifds = UTIF.decode(buff);
	assert.deepStrictEqual(ifds.map(function(d){return d.t256[0];}), [3, 5, 2]);
	assert.deepStrictEqual(ifds.map(function(d){return d.t257[0];}), [2, 4, 2]);
});

test("rejects a bad byte-order mark", function() {
	var px = H.gray8(2, 2);
	var buff = new Writer(true).addPage(2, 2, px, { photometric: 1 }).build();
	new Uint8Array(buff)[0] = 0x58;
	expectTiffError(function(){ UTIF.decode(buff); }, "BAD_BYTE_ORDER");
});

test("rejects a bad TIFF magic number", function() {
	var px = H.gray8(2, 2);
	var buff = new Writer(true).addPage(2, 2, px, { photometric: 1 }).build();
	var u8 = new Uint8Array(buff); u8[2] = 0; u8[3] = 7;
	expectTiffError(function(){ UTIF.decode(buff); }, "BAD_MAGIC");
});

test("rejects a first IFD offset outside the file", function() {
	var px = H.gray8(2, 2);
	var buff = new Writer(true).addPage(2, 2, px, { photometric: 1 }).build();
	var u8 = new Uint8Array(buff);
	u8[4]=0xff; u8[5]=0xff; u8[6]=0xff; u8[7]=0x7f;
	expectTiffError(function(){ UTIF.decode(buff); }, "IFD_OUT_OF_BOUNDS");
});

test("rejects a truncated IFD entry count region", function() {
	var px = H.gray8(2, 2);
	var buff = new Writer(true).addPage(2, 2, px, { photometric: 1 }).build();
	var u8 = new Uint8Array(buff);
	// point the first IFD at the last two bytes: count readable, entries not
	var ifdo = u8.length - 2;
	u8[4]=ifdo&255; u8[5]=(ifdo>>>8)&255; u8[6]=0; u8[7]=0;
	u8[ifdo]=5; u8[ifdo+1]=0;   // claims 5 entries with no room
	expectTiffError(function(){ UTIF.decode(buff); }, "IFD_TRUNCATED");
});

test("rejects a self-referential (circular) IFD pointer", function() {
	var px = H.gray8(2, 2);
	var buff = new Writer(true).addPage(2, 2, px, { photometric: 1 }).build();
	var u8 = new Uint8Array(buff);
	var ifdo = u8[4] | (u8[5]<<8);   // IFD starts at 8
	var cnt = u8[ifdo] | (u8[ifdo+1]<<8);
	var nextPos = ifdo + 2 + cnt*12;
	u8[nextPos]=ifdo&255; u8[nextPos+1]=(ifdo>>>8)&255; u8[nextPos+2]=0; u8[nextPos+3]=0;
	expectTiffError(function(){ UTIF.decode(buff); }, "CIRCULAR_IFD");
});

test("rejects an unknown (illegal) tag type", function() {
	var px = H.gray8(2, 2);
	var buff = new Writer(true).addPage(2, 2, px, { photometric: 1 }).build();
	var u8 = new Uint8Array(buff);
	var ifdo = 8;
	// first entry's type field sits at ifdo+2+2
	u8[ifdo+4] = 99; u8[ifdo+5] = 0;
	expectTiffError(function(){ UTIF.decode(buff); }, "UNKNOWN_TAG_TYPE");
});

test("rejects a truncated external tag value", function() {
	var px = H.gray8(2, 2);
	// a long ASCII Software tag forces an external value area
	var buff = new Writer(true).addPage(2, 2, px, {
		photometric: 1,
		extraTags: [{ tag: 305, type: 2, value: strVal("12345678901234567890") }]
	}).build();
	var u8 = new Uint8Array(buff);
	var ifdo = 8, cnt = u8[ifdo] | (u8[ifdo+1]<<8);
	var found = null;
	for(var i=0;i<cnt;i++) {
		var b = ifdo+2+i*12, tag = u8[b] | (u8[b+1]<<8);
		if(tag===305) { found = b; break; }
	}
	assert.ok(found!==null, "software tag present");
	// corrupt its value offset to point beyond EOF
	u8[found+8]=0xfe; u8[found+9]=0xff; u8[found+10]=0; u8[found+11]=0;
	expectTiffError(function(){ UTIF.decode(buff); }, "TAG_VALUE_TRUNCATED");
});

test("keeps page-private (unknown-numbered) tags", function() {
	var px = H.gray8(2, 2);
	var buff = new Writer(true).addPage(2, 2, px, {
		photometric: 1,
		extraTags: [{ tag: 700, type: 3, value: [1234, 5678] }]
	}).build();
	var ifds = UTIF.decode(buff);
	assert.deepStrictEqual(Array.from(ifds[0].t700), [1234, 5678]);
});

test("EXIF-only IFD (no width) is not treated as a pixel page", function() {
	var buff = new Writer(true).addPage(2, 2, H.gray8(2,2), { photometric: 1 }).build();
	var ifds = UTIF.decode(buff);
	// craft a second IFD object that carries only EXIF-style metadata, no t256
	var exif = { t305: ["Camera"], t33434: [[1,200]] };
	expectTiffError(function(){ UTIF.decodeImage(buff, exif); }, "NOT_AN_IMAGE");
});

test("non-buffer input is rejected with a stable error", function() {
	expectTiffError(function(){ UTIF.decode(null); }, "NOT_A_BUFFER");
});

function strVal(s) { return [s]; }
