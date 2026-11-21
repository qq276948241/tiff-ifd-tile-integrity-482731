"use strict";
// A self-contained TIFF writer used ONLY to build test fixtures. It shares no
// code with the decoder under test, so the decoder cannot be validated against
// its own assumptions. Supports LE/BE, strips and tiles, chunky/planar layout,
// uncompressed / PackBits / LZW, and the horizontal (type 2) predictor.
var packbits = require("./packbits-encode");
var lzw = require("./lzw-encode");

var TYPE_SIZE = {1:1, 2:1, 3:2, 4:4, 5:8, 7:1, 8:2, 9:4, 10:8, 11:4, 12:8, 13:4};

function Writer(le) {
	this.le = le !== false;          // default little-endian
	this.pages = [];
}

// pixels: Uint8Array of raw, chunky, host-endian samples (LE on disk by default)
// opts: { bps, spp, photometric, compression, predictor, planar, rps, tileW, tileH,
//         extraTags:[{tag,type,value}], bigEndianSamples:bool }
Writer.prototype.addPage = function(width, height, pixels, opts) {
	opts = opts || {};
	this.pages.push({ width: width, height: height, pixels: pixels, opts: opts });
	return this;
};

Writer.prototype._u16 = function(arr, p, v) {
	if(this.le) { arr[p] = v & 255; arr[p+1] = (v >>> 8) & 255; }
	else       { arr[p] = (v >>> 8) & 255; arr[p+1] = v & 255; }
};
Writer.prototype._u32 = function(arr, p, v) {
	v = v >>> 0;
	if(this.le) { arr[p]=v&255; arr[p+1]=(v>>>8)&255; arr[p+2]=(v>>>16)&255; arr[p+3]=(v>>>24)&255; }
	else       { arr[p]=(v>>>24)&255; arr[p+1]=(v>>>16)&255; arr[p+2]=(v>>>8)&255; arr[p+3]=v&255; }
};

// Split raw chunky pixel bytes into the on-disk blocks for one page.
Writer.prototype._blocks = function(page) {
	var o = page.opts, w = page.width, h = page.height;
	var le = this.le;
	var bps = o.bps || 8, spp = o.spp || 1;
	var sampleBytes = Math.ceil(bps/8);
	var planar = o.planar === 2;
	var rowBytesChunky = Math.ceil(w * bps * spp / 8);
	var rowBytesPlane  = Math.ceil(w * bps / 8);

	// Optional big-endian sample conversion for 16-bit fixtures.
	function diskSamples(view) {
		if(!(bps === 16 && o.bigEndianSamples)) return view;
		var copy = new Uint8Array(view.length);
		for(var k = 0; k < view.length; k += 2) { copy[k] = view[k+1]; copy[k+1] = view[k]; }
		return copy;
	}

	function applyPredictor(block, blockW, noc) {
		if(o.predictor !== 2) return block;
		var bpp = sampleBytes * noc;
		var bpl = Math.ceil(blockW * bps * noc / 8);
		var out = new Uint8Array(block.length);
		if(bps === 16) {
			// The predictor runs on host (little-endian) bytes; diskSamples (any
			// endian swap) is applied only afterwards. So interpret samples as LE.
			for(var row = 0; row*bpl < block.length; row++) {
				var base = row*bpl;
				var samplesInRow = bpl/2;
				for(var s = 0; s < samplesInRow; s++) {
					var p = base + s*2;
					if(s*2 < bpp) { out[p]=block[p]; out[p+1]=block[p+1]; continue; }
					var cur  = block[p] | (block[p+1]<<8);
					var pp = p - bpp;
					var prev = block[pp] | (block[pp+1]<<8);
					var d = (cur - prev) & 0xffff;
					out[p]   = d & 255;
					out[p+1] = (d >>> 8) & 255;
				}
			}
			return out;
		}
		for(var r2 = 0; r2*bpl < block.length; r2++) {
			var b2 = r2*bpl;
			for(var x = 0; x < bpl; x++) {
				out[b2+x] = x < bpp ? block[b2+x]
					: (block[b2+x] - block[b2+x-bpp]) & 255;
			}
		}
		return out;
	}

	function compress(block) {
		if(o.compression === 32773) return packbits.encodePackBits(block);
		if(o.compression === 5)     return lzw.encodeLZW(block);
		return block;               // compression 1 (default)
	}

	var blocks = [];   // ordered on-disk chunks
	if(o.tileW && o.tileH) {
		var tw = o.tileW, th = o.tileH;
		var tx = Math.ceil(w/tw), ty = Math.ceil(h/th);
		var tileRowChunky = Math.ceil(tw*bps*spp/8);
		var tileRowPlane  = Math.ceil(tw*bps/8);
		for(var comp = 0; comp < (planar ? spp : 1); comp++) {
			for(var tyi = 0; tyi < ty; tyi++)
				for(var txi = 0; txi < tx; txi++) {
					var tile = new Uint8Array(th * (planar ? tileRowPlane : tileRowChunky));
					var effW = Math.min(tw, w - txi*tw), effH = Math.min(th, h - tyi*th);
					for(var yy = 0; yy < effH; yy++) {
						for(var xx = 0; xx < effW; xx++) {
							var sy = tyi*th + yy, sx = txi*tw + xx;
							if(planar) {
								for(var sb = 0; sb < sampleBytes; sb++)
									tile[yy*tileRowPlane + xx*sampleBytes + sb] =
										page.pixels[(sy*w+sx)*spp*sampleBytes + comp*sampleBytes + sb];
							} else {
								var si = (sy*w+sx)*spp*sampleBytes, di = yy*tileRowChunky + xx*spp*sampleBytes;
								for(var q = 0; q < spp*sampleBytes; q++) tile[di+q] = page.pixels[si+q];
							}
						}
					}
					tile = applyPredictor(tile, tw, planar ? 1 : spp);
					tile = diskSamples(tile);
					blocks.push(compress(tile));
				}
		}
		return { blocks: blocks, tileW: tw, tileH: th, tx: tx, ty: ty };
	}

	// strips
	var rps = o.rps || h;
	var nStrips = Math.ceil(h/rps);
	for(var comp = 0; comp < (planar ? spp : 1); comp++) {
		for(var s = 0; s < nStrips; s++) {
			var rows = (s === nStrips-1) ? (h - s*rps) : rps;
			var strip = new Uint8Array(rows * (planar ? rowBytesPlane : rowBytesChunky));
			for(var ry = 0; ry < rows; ry++) {
				var syy = s*rps + ry;
				for(var sxx = 0; sxx < w; sxx++) {
					if(planar) {
						for(var sb2 = 0; sb2 < sampleBytes; sb2++)
							strip[ry*rowBytesPlane + sxx*sampleBytes + sb2] =
								page.pixels[(syy*w+sxx)*spp*sampleBytes + comp*sampleBytes + sb2];
					} else {
						var ssi = (syy*w+sxx)*spp*sampleBytes, ddi = ry*rowBytesChunky + sxx*spp*sampleBytes;
						for(var q2 = 0; q2 < spp*sampleBytes; q2++) strip[ddi+q2] = page.pixels[ssi+q2];
					}
				}
			}
			strip = applyPredictor(strip, w, planar ? 1 : spp);
			strip = diskSamples(strip);
			blocks.push(compress(strip));
		}
	}
	return { blocks: blocks, rps: rps, nStrips: nStrips };
}

// Encode one tag entry + any external payload. Returns {entry:Uint8Array(12), payload, align}.
Writer.prototype._entry = function(tag, type, values) {
	// A type-2 (ASCII) value is a single JS string: turn it into its NUL-terminated
	// byte sequence so `count` is the byte count, as the TIFF spec requires.
	if(type === 2 && typeof values[0] === "string") {
		var s = values[0];
		values = [];
		for(var ci = 0; ci < s.length; ci++) values.push(s.charCodeAt(ci) & 255);
		values.push(0);
	}
	var size = TYPE_SIZE[type], count = values.length, total = size*count;
	var entry = new Uint8Array(12);
	this._u16(entry, 0, tag);
	this._u16(entry, 2, type);
	this._u32(entry, 4, count);
	var payload = null;
	var inlineArea = entry.subarray(8, 12);
	function numAt(arr, p, type, val, self) {
		if(type === 3 || type === 8) self._u16(arr, p, val & 0xffff);
		else if(type === 4 || type === 9 || type === 13) self._u32(arr, p, val);
	}
	if(total <= 4) {
		if(type === 2 || type === 7 || type === 1) {
			for(var k = 0; k < total; k++) inlineArea[k] = values[k];
		} else {
			for(var k2 = 0; k2 < count; k2++) numAt(inlineArea, k2*size, type, values[k2], this);
		}
		} else {
			if(type === 2) {
				payload = new Uint8Array(total);
				for(var a = 0; a < total; a++) payload[a] = values[a];
			} else if(type === 7 || type === 1) {
				payload = new Uint8Array(total);
				for(var b = 0; b < total; b++) payload[b] = values[b];
			} else if(type === 5 || type === 10) {
				payload = new Uint8Array(total);
				for(var r = 0; r < count; r++) {
					self._u32(payload, r*8,   values[r][0] >>> 0);
					self._u32(payload, r*8+4, values[r][1] >>> 0);
				}
			} else {
				// SHORT/LONG/SLONG/FLOAT/DOUBLE arrays that do not fit inline.
				// Placeholder offsets (all zero) still allocate a real payload so
				// the build pass can patch them in place.
				payload = new Uint8Array(total);
				for(var n = 0; n < count; n++) numAt(payload, n*size, type, values[n], this);
			}
		}
	return { entry: entry, payload: payload, total: total };
};

Writer.prototype.build = function() {
	var self = this;
	// First assemble each page's tag list and blocks.
	var built = this.pages.map(function(page) {
		var o = page.opts;
		var bps = o.bps || 8, spp = o.spp || 1;
		var layout = self._blocks(page);
		var tags = [];
		var tagSeen = {};
		function add(tag, type, values) { if(!tagSeen[tag]) { tagSeen[tag] = 1; tags.push({ tag: tag, type: type, values: values }); } }
		add(256, 4, [page.width]);
		add(257, 4, [page.height]);
		add(258, 3, new Array(spp).fill(bps));
		add(259, 3, [o.compression || 1]);
		add(262, 3, [o.photometric != null ? o.photometric : (spp >= 3 ? 2 : 1)]);
		add(277, 3, [spp]);
		add(284, 3, [o.planar || 1]);
		add(296, 3, [1]);                 // planar units = pixel
		add(339, 3, [1]);                 // sample format unsigned integer
		if(o.predictor) add(317, 3, [o.predictor]);
		if(o.orientation) add(274, 3, [o.orientation]);
		if(o.tileW && o.tileH) {
			add(322, 4, [layout.tileW]);
			add(323, 4, [layout.tileH]);
			add(324, 4, layout.blocks.map(function(){return 0;})); // offsets patched later
			add(325, 4, layout.blocks.map(function(b){return b.length;}));
		} else {
			add(278, 4, [layout.rps]);
			add(273, 4, layout.blocks.map(function(){return 0;})); // offsets patched later
			add(279, 4, layout.blocks.map(function(b){return b.length;}));
		}
		(o.extraTags || []).forEach(function(t) { add(t.tag, t.type, t.value); });
		return { tags: tags, blocks: layout.blocks };
	});

	// Layout pass: header (8) then each IFD, external payloads, then pixel blocks.
	var cursor = 8;
	var pageMeta = built.map(function(b) {
		var n = b.tags.length;
		var ifdStart = cursor;
		cursor += 2 + n*12 + 4;
		var entries = b.tags.map(function(t) {
			var e = self._entry(t.tag, t.type, t.values);
			if(e.payload) {
				if(cursor & 1) cursor++;           // word-align payloads
				e.payloadOffset = cursor;
				cursor += e.payload.length;
			}
			return e;
		});
		return { ifdStart: ifdStart, entries: entries, tags: b.tags, blocks: b.blocks };
	});

	// Pixel blocks come after every IFD and all its external payloads.
	var blockRun = cursor;
	pageMeta.forEach(function(meta) {
		meta.blockOffsets = meta.blocks.map(function(block) { var o = blockRun; blockRun += block.length; return o; });
	});
	var total = blockRun;

	var file = new Uint8Array(total);
	file[0] = this.le ? 0x49 : 0x4d;
	file[1] = this.le ? 0x49 : 0x4d;
	this._u16(file, 2, 42);
	this._u32(file, 4, pageMeta.length ? pageMeta[0].ifdStart : 0);

	pageMeta.forEach(function(meta, pi) {
		var n = meta.tags.length;
		self._u16(file, meta.ifdStart, n);
		var nextOff = (pi < pageMeta.length-1) ? pageMeta[pi+1].ifdStart : 0;
		var offsetTag = meta.tags.some(function(t){return t.tag===324;}) ? 324 : 273;
		// Write placeholder payloads first, so the offset-array patch below is not
		// overwritten by the all-zero placeholder.
		meta.entries.forEach(function(e) {
			if(e.payload) file.set(e.payload, e.payloadOffset);
		});
		meta.entries.forEach(function(e, ei) {
			var tag = meta.tags[ei].tag;
			var ep = meta.ifdStart + 2 + ei*12;
			file.set(e.entry, ep);
			if(e.payload) self._u32(file, ep+8, e.payloadOffset);
			if(tag === offsetTag) {
				if(meta.blockOffsets.length === 1) {
					self._u32(file, ep+8, meta.blockOffsets[0]);   // single offset fits inline
				} else {
					// Build the offset array into the already-reserved payload region.
					meta.blockOffsets.forEach(function(off, k){ self._u32(file, e.payloadOffset + k*4, off); });
				}
			}
		});
		self._u32(file, meta.ifdStart + 2 + n*12, nextOff);
	});
	pageMeta.forEach(function(meta) {
		meta.blocks.forEach(function(block, k) { file.set(block, meta.blockOffsets[k]); });
	});
	return file.buffer;
};

module.exports = { Writer: Writer, TYPE_SIZE: TYPE_SIZE };
