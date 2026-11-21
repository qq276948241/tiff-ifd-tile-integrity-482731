"use strict";
// Strip decoding: chunky/planar layouts, 8/16-bit grayscale & RGB, uncompressed,
// PackBits, LZW and the horizontal predictor, with hand-computed references.
var test = require("node:test");
var H = require("./lib/helpers");
var UTIF = H.UTIF, Writer = H.Writer, assert = H.assert, expectTiffError = H.expectTiffError;

test("uncompressed 8-bit grayscale strip matches hand-computed pixels", function() {
	var w=6,h=5, px=H.gray8(w,h);
	var buff = H.buildOne(w,h,px,{compression:1,photometric:1});
	var ifd = H.decodeFirst(buff);
	assert.deepStrictEqual(Array.from(ifd.data), Array.from(px));
	H.assertRGBA(UTIF.toRGBA8(ifd), H.expectedGrayRGBA8(w,h), "gray8");
});

test("PackBits strip round-trips byte-for-byte", function() {
	var w=7,h=4, px=H.gray8(w,h);
	var buff = H.buildOne(w,h,px,{compression:32773,photometric:1});
	var ifd = H.decodeFirst(buff);
	assert.deepStrictEqual(Array.from(ifd.data), Array.from(px));
});

test("LZW single and multi strip round-trip byte-for-byte", function() {
	var w=8,h=6, px=H.gray8(w,h);
	[undefined, 3, 2].forEach(function(rps) {
		var buff = H.buildOne(w,h,px,{compression:5,photometric:1,rps:rps});
		var ifd = H.decodeFirst(buff);
		assert.deepStrictEqual(Array.from(ifd.data), Array.from(px), "rps=" + rps);
	});
});

test("16-bit grayscale preserves high data and scales by fixed rule", function() {
	var w=5,h=4, px=H.gray16(w,h);
	var buff = H.buildOne(w,h,px,{compression:1,photometric:1,bps:16,spp:1});
	var ifd = H.decodeFirst(buff);
	// raw high-bit data stays queryable, untouched
	assert.deepStrictEqual(Array.from(ifd.data), Array.from(px));
	var rgba = UTIF.toRGBA8(ifd);
	// literal anchor: pixel (0,0) and (2,3)
	[[0,0],[2,3]].forEach(function(pt) {
		var x=pt[0],y=pt[1], v=H.sample16(x,y,0), i=(y*w+x)*4, g=H.scale16(v);
		assert.strictEqual(rgba[i], g, "scaled gray anchor");
		assert.strictEqual(rgba[i+3], 255);
	});
});

test("16-bit big-endian grayscale is byte-swapped correctly", function() {
	var w=4,h=3, px=H.gray16(w,h);
	var buff = H.buildOne(w,h,px,{compression:1,photometric:1,bps:16,spp:1,bigEndianSamples:true}, false);
	var ifd = H.decodeFirst(buff);
	// after decode, samples must be little-endian host order equal to the LE reference
	assert.deepStrictEqual(Array.from(ifd.data), Array.from(px));
});

test("8-bit RGB chunky strips decode and keep alpha opaque", function() {
	var w=5,h=4, px=H.rgb8(w,h);
	var buff = H.buildOne(w,h,px,{compression:1,photometric:2,bps:8,spp:3});
	var ifd = H.decodeFirst(buff);
	assert.deepStrictEqual(Array.from(ifd.data), Array.from(px));
	var rgba = UTIF.toRGBA8(ifd);
	for(var y=0;y<h;y++) for(var x=0;x<w;x++) {
		var i=(y*w+x)*4;
		assert.strictEqual(rgba[i],   H.sample8(x,y,0), "R");
		assert.strictEqual(rgba[i+1], H.sample8(x,y,1), "G");
		assert.strictEqual(rgba[i+2], H.sample8(x,y,2), "B");
		assert.strictEqual(rgba[i+3], 255, "A");
	}
});

test("16-bit RGB scales all three channels with the fixed rule", function() {
	var w=4,h=3, px=H.rgb16(w,h);
	var buff = H.buildOne(w,h,px,{compression:1,photometric:2,bps:16,spp:3});
	var ifd = H.decodeFirst(buff);
	var rgba = UTIF.toRGBA8(ifd);
	for(var y=0;y<h;y++) for(var x=0;x<w;x++) {
		var i=(y*w+x)*4;
		for(var c=0;c<3;c++) assert.strictEqual(rgba[i+c], H.scale16(H.sample16(x,y,c)));
		assert.strictEqual(rgba[i+3], 255);
	}
});

test("planar configuration 2 grayscale/RGB reassembles into chunky pixels", function() {
	var w=6,h=4, px=H.rgb8(w,h);
	var buff = H.buildOne(w,h,px,{compression:1,photometric:2,bps:8,spp:3,planar:2,rps:2});
	var ifd = H.decodeFirst(buff);
	assert.deepStrictEqual(Array.from(ifd.data), Array.from(px), "planar->chunky");
});

test("planar configuration 2 works big-endian and with 16-bit samples", function() {
	var w=6,h=4, px16=H.rgb16(w,h);
	var buff = H.buildOne(w,h,px16,{compression:1,photometric:2,bps:16,spp:3,planar:2,rps:2,
		bigEndianSamples:true}, false);
	var ifd = H.decodeFirst(buff);
	assert.deepStrictEqual(Array.from(ifd.data), Array.from(px16), "BE planar 16-bit -> chunky LE");
});

test("horizontal predictor (type 2) reverses LZW and PackBits differences", function() {
	var w=8,h=5, px=H.rgb8(w,h);
	[5, 32773].forEach(function(cmpr) {
		var buff = H.buildOne(w,h,px,{compression:cmpr,photometric:2,bps:8,spp:3,predictor:2,rps:3});
		var ifd = H.decodeFirst(buff);
		assert.deepStrictEqual(Array.from(ifd.data), Array.from(px), "predictor cmpr=" + cmpr);
	});
});

test("predictor type 2 on 16-bit grayscale reconstructs samples", function() {
	var w=5,h=4, px=H.gray16(w,h);
	var buff = H.buildOne(w,h,px,{compression:5,photometric:1,bps:16,spp:1,predictor:2,rps:2});
	var ifd = H.decodeFirst(buff);
	assert.deepStrictEqual(Array.from(ifd.data), Array.from(px));
});

test("mismatched planar strip count is rejected", function() {
	var w=4,h=4, px=H.rgb8(w,h);
	var buff = H.buildOne(w,h,px,{compression:1,photometric:2,bps:8,spp:3,planar:2,rps:2});
	var u8=new Uint8Array(buff);
	var ifds=UTIF.decode(buff);
	// claim only one strip instead of the required 3*nStrips
	ifds[0].t273 = [ifds[0].t273[0]];
	ifds[0].t279 = [ifds[0].t279[0]];
	expectTiffError(function(){ UTIF.decodeImage(buff, ifds[0]); }, "STRIP_COUNT_MISMATCH");
});

test("out-of-range strip offset is rejected before expansion", function() {
	var w=4,h=4, px=H.gray8(w,h);
	var buff = H.buildOne(w,h,px,{compression:1,photometric:1});
	var u8=new Uint8Array(buff);
	var ifds=UTIF.decode(buff);
	ifds[0].t273 = [u8.length + 100];
	expectTiffError(function(){ UTIF.decodeImage(buff, ifds[0]); }, "CHUNK_OUT_OF_BOUNDS");
});

test("a failed decode clears temporary image state", function() {
	var w=4,h=4, px=H.gray8(w,h);
	var buff = H.buildOne(w,h,px,{compression:1,photometric:1});
	var ifds=UTIF.decode(buff);
	ifds[0].t273 = [new Uint8Array(buff).length + 50];
	expectTiffError(function(){ UTIF.decodeImage(buff, ifds[0]); }, "CHUNK_OUT_OF_BOUNDS");
	assert.strictEqual(ifds[0].data, undefined);
	assert.strictEqual(ifds[0].width, undefined);
	assert.strictEqual(ifds[0].height, undefined);
});

test("repeated decodeImage on the same IFD is idempotent", function() {
	var w=4,h=3, px=H.gray8(w,h);
	var buff = H.buildOne(w,h,px,{compression:1,photometric:1});
	var ifd = H.decodeFirst(buff);
	var first = ifd.data;
	UTIF.decodeImage(buff, ifd);
	assert.strictEqual(ifd.data, first, "same buffer retained on repeat");
});
