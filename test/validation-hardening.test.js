"use strict";
// Validation hardening: integer overflow, unknown compression, corrupt LZW /
// PackBits streams, sub-IFD cycles, bad dimensions, and predictor rejection.
var test = require("node:test");
var H = require("./lib/helpers");
var UTIF = H.UTIF, Writer = H.Writer, assert = H.assert, expectTiffError = H.expectTiffError;

test("checkedMul rejects products beyond safe integer range", function() {
	// exercised indirectly via huge declared dimensions
	var w=2,h=2, px=H.gray8(w,h);
	var buff = H.buildOne(w,h,px,{photometric:1});
	var ifds = UTIF.decode(buff);
	ifds[0].t256 = [0x40000000];
	ifds[0].t257 = [0x40000000];
	expectTiffError(function(){ UTIF.decodeImage(buff, ifds[0]); }, "OVERFLOW");
});

test("zero or negative dimensions are rejected", function() {
	var w=2,h=2, px=H.gray8(w,h);
	var buff = H.buildOne(w,h,px,{photometric:1});
	[[0,2],[2,0]].forEach(function(d) {
		var ifds = UTIF.decode(buff);
		ifds[0].t256=[d[0]]; ifds[0].t257=[d[1]];
		expectTiffError(function(){ UTIF.decodeImage(buff, ifds[0]); }, "BAD_DIMENSION");
	});
});

test("unknown compression code is rejected with a stable error", function() {
	var w=4,h=4, px=H.gray8(w,h);
	var buff = H.buildOne(w,h,px,{photometric:1});
	var ifds = UTIF.decode(buff);
	ifds[0].t259 = [9999];
	expectTiffError(function(){ UTIF.decodeImage(buff, ifds[0]); }, "UNSUPPORTED_COMPRESSION");
});

test("a truncated LZW stream cannot write past the output region", function() {
	var w=8,h=4, px=H.gray8(w,h);
	var buff = H.buildOne(w,h,px,{compression:5,photometric:1});
	var ifds = UTIF.decode(buff);
	// shrink the declared byte count so the stream is cut mid-table
	ifds[0].t279 = [Math.max(2, ifds[0].t279[0]-3)];
	var threw = false;
	try { UTIF.decodeImage(buff, ifds[0]); }
	catch(e) {
		threw = true;
		assert.ok(e instanceof UTIF.TiffError, "TiffError expected, got " + e);
		assert.ok(["DECOMPRESS_SIZE","DECOMPRESS_FAILED","DECOMPRESS_OVERFLOW"].indexOf(e.code) !== -1,
			"unexpected code " + e.code);
	}
	assert.ok(threw, "truncated LZW must fail");
	assert.strictEqual(ifds[0].data, undefined, "state cleared after LZW failure");
});

test("a malformed PackBits repeat cannot overflow the target", function() {
	// Multi-strip uncompressed base: the first strip's region sits in the middle
	// of the file, so a planted stream has file room even though its expanded
	// output exceeds the per-strip target region.
	var w=8,h=8, px=H.gray8(w,h);
	var buff = H.buildOne(w,h,px,{compression:1,photometric:1,rps:2});
	var ifds = UTIF.decode(buff);
	var u8 = new Uint8Array(buff);
	var off0 = ifds[0].t273[0];
	// 16-byte first-strip region; a stream of 9 repeat pairs (18 source bytes,
	// 18 output bytes) overflows the 16-byte region while fitting in the file.
	var stream = new Uint8Array(18);
	for(var k=0;k<stream.length;k+=2){ stream[k]=0xff; stream[k+1]=0x41; }
	assert.ok(off0 + stream.length <= u8.length, "room to plant stream");
	u8.set(stream, off0);
	// repoint the first strip only: keep offsets array length, shrink its count
	ifds[0].t259 = [32773];
	var counts = ifds[0].t279.slice(); counts[0] = stream.length;
	ifds[0].t279 = counts;
	expectTiffError(function(){ UTIF.decodeImage(buff, ifds[0]); }, "DECOMPRESS_OVERFLOW");
});

test("circular sub-IFD pointer is rejected", function() {
	var w=2,h=2, px=H.gray8(w,h);
	// build a file with an EXIF IFD (tag 34665) then point it back at itself
	var buff = new Writer(true).addPage(w,h,px,{
		photometric:1,
		extraTags:[{tag:34665,type:4,value:[0]}]   // placeholder, patched below
	}).build();
	var u8 = new Uint8Array(buff);
	var ifdo = 8, cnt = u8[ifdo] | (u8[ifdo+1]<<8);
	for(var i=0;i<cnt;i++){
		var b = ifdo+2+i*12, tag = u8[b] | (u8[b+1]<<8);
		if(tag===34665){
			// point the EXIF IFD offset back at the main IFD
			u8[b+8]=ifdo&255; u8[b+9]=(ifdo>>>8)&255; u8[b+10]=0; u8[b+11]=0;
			break;
		}
	}
	expectTiffError(function(){ UTIF.decode(buff); }, "CIRCULAR_IFD");
});

test("an unsupported predictor value is rejected up front", function() {
	var w=4,h=4, px=H.gray8(w,h);
	var buff = H.buildOne(w,h,px,{photometric:1});
	var ifds = UTIF.decode(buff);
	ifds[0].t317 = [99];
	expectTiffError(function(){ UTIF.decodeImage(buff, ifds[0]); }, "BAD_PREDICTOR");
});

test("toRGBA8 before decodeImage fails with a stable error", function() {
	var ifd = { width:2, height:2 };
	expectTiffError(function(){ UTIF.toRGBA8(ifd); }, "NOT_DECODED");
});

test("offset/byte-count length mismatch is rejected", function() {
	var w=4,h=4, px=H.gray8(w,h);
	var buff = H.buildOne(w,h,px,{photometric:1});
	var ifds = UTIF.decode(buff);
	ifds[0].t279 = [ifds[0].t279[0], ifds[0].t279[0]];  // two counts, one offset
	expectTiffError(function(){ UTIF.decodeImage(buff, ifds[0]); }, "OFFSET_COUNT_MISMATCH");
});
