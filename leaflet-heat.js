/*
 (c) 2014, Vladimir Agafonkin
 Leaflet.heat, a tiny and fast heatmap plugin for Leaflet.
 https://github.com/Leaflet/Leaflet.heat
*/
L.HeatLayer = (L.Layer ? L.Layer : L.Class).extend({
    initialize: function (latlngs, options) {
        this._latlngs = latlngs;
        L.setOptions(this, options);
    },
    setLatLngs: function (latlngs) {
        this._latlngs = latlngs;
        return this.redraw();
    },
    addLatLng: function (latlng) {
        this._latlngs.push(latlng);
        return this.redraw();
    },
    setOptions: function (options) {
        L.setOptions(this, options);
        if (this._heat) { this._updateOptions(); }
        return this.redraw();
    },
    redraw: function () {
        if (this._heat && !this._frame && this._map && !this._map._animating) {
            this._frame = L.Util.requestAnimFrame(this._redraw, this);
        }
        return this;
    },
    onAdd: function (map) {
        this._map = map;
        if (!this._canvas) { this._initCanvas(); }
        if (this.options.pane) { this.getPane().appendChild(this._canvas); }
        else { map._panes.overlayPane.appendChild(this._canvas); }
        map.on('moveend', this._reset, this);
        if (map.options.zoomAnimation && L.Browser.any3d) { map.on('zoomanim', this._animateZoom, this); }
        this._reset();
    },
    onRemove: function (map) {
        if (this.options.pane) { this.getPane().removeChild(this._canvas); }
        else { map.getPanes().overlayPane.removeChild(this._canvas); }
        map.off('moveend', this._reset, this);
        if (map.options.zoomAnimation) { map.off('zoomanim', this._animateZoom, this); }
    },
    _initCanvas: function () {
        var canvas = this._canvas = L.DomUtil.create('canvas', 'leaflet-heat-layer leaflet-layer');
        var originProp = L.DomUtil.testProp(['transformOrigin', 'WebkitTransformOrigin', 'msTransformOrigin']);
        canvas.style[originProp] = '50% 50%';
        var size = this._map.getSize();
        canvas.width = size.x; canvas.height = size.y;
        var animated = this._map.options.zoomAnimation && L.Browser.any3d;
        L.DomUtil.addClass(canvas, 'leaflet-zoom-' + (animated ? 'animated' : 'hide'));
        this._heat = simpleheat(canvas);
        this._updateOptions();
    },
    _updateOptions: function () {
        this._heat.radius(this.options.radius || this._heat.defaultRadius, this.options.blur);
        if (this.options.gradient) { this._heat.gradient(this.options.gradient); }
        if (this.options.max) { this._heat.max(this.options.max); }
    },
    _reset: function () { var pos = this._map.containerPointToLayerPoint([0, 0]); L.DomUtil.setPosition(this._canvas, pos); var size = this._map.getSize(); if (this._heat._width !== size.x) { this._canvas.width = this._heat._width = size.x; } if (this._heat._height !== size.y) { this._canvas.height = this._heat._height = size.y; } this._redraw(); },
    _redraw: function () { if (!this._map) return; var data = [], r = this._heat._r, size = this._map.getSize(), bounds = new L.Bounds(L.point([-r, -r]), size.add([r, r])), max = this.options.max === undefined ? 1 : this.options.max, maxZoom = this.options.maxZoom === undefined ? this._map.getMaxZoom() : this.options.maxZoom, v = 1 / Math.pow(2, Math.max(0, Math.min(maxZoom - this._map.getZoom(), 12))), scale = r / 2, jlen = this._latlngs.length, i, j, len, p, latlng, v2; for (i = 0; i < jlen; i++) { latlng = this._latlngs[i]; p = this._map.latLngToContainerPoint(latlng); if (bounds.contains(p)) { v2 = latlng.length > 2 ? latlng[2] : latlng.alt !== undefined ? latlng.alt : 1; data.push([Math.round(p.x), Math.round(p.y), v2]); } } this._heat.data(data).draw(this.options.minOpacity); this._frame = null; },
    _animateZoom: function (e) { var scale = this._map.getZoomScale(e.zoom), offset = this._map._getCenterOffset(e.center)._multiplyBy(-scale).add(this._map._getInitialWorldOffset()); if (L.DomUtil.setTransform) { L.DomUtil.setTransform(this._canvas, offset, scale); } else { this._canvas.style[L.DomUtil.TRANSFORM] = L.DomUtil.getTranslateString(offset) + ' scale(' + scale + ')'; } }
});
L.heatLayer = function (latlngs, options) { return new L.HeatLayer(latlngs, options); };
function simpleheat(canvas) { if (!(this instanceof simpleheat)) return new simpleheat(canvas); this._canvas = canvas = typeof canvas === 'string' ? document.getElementById(canvas) : canvas; this._ctx = canvas.getContext('2d'); this._width = canvas.width; this._height = canvas.height; this._max = 1; this._data = []; }
simpleheat.prototype = { defaultRadius: 25, defaultGradient: { 0.4: 'blue', 0.6: 'cyan', 0.7: 'lime', 0.8: 'yellow', 1.0: 'red' }, data: function (data) { this._data = data; return this; }, max: function (max) { this._max = max; return this; }, add: function (point) { this._data.push(point); return this; }, clear: function () { this._data = []; return this; }, radius: function (r, blur) { blur = blur === undefined ? 15 : blur; var circle = this._circle = L.DomUtil.create('canvas'), ctx = circle.getContext('2d'), r2 = this._r = r + blur; circle.width = circle.height = r2 * 2; ctx.shadowBlur = blur; ctx.shadowColor = 'black'; ctx.beginPath(); ctx.arc(r2, r2, r, 0, Math.PI * 2, true); ctx.closePath(); ctx.fill(); return this; }, gradient: function (grad) { var canvas = L.DomUtil.create('canvas'), ctx = canvas.getContext('2d'), gradient = ctx.createLinearGradient(0, 0, 0, 256); canvas.width = 1; canvas.height = 256; for (var i in grad) { gradient.addColorStop(+i, grad[i]); } ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1, 256); this._grad = ctx.getImageData(0, 0, 1, 256).data; return this; }, draw: function (minOpacity) { if (!this._circle) this.radius(this.defaultRadius); if (!this._grad) this.gradient(this.defaultGradient); var ctx = this._ctx; ctx.clearRect(0, 0, this._width, this._height); for (var i = 0, len = this._data.length, p; i < len; i++) { p = this._data[i]; ctx.globalAlpha = Math.max(p[2] / this._max, minOpacity || 0.05); ctx.drawImage(this._circle, p[0] - this._r, p[1] - this._r); } var colored = ctx.getImageData(0, 0, this._width, this._height); this._colorize(colored.data, this._grad); ctx.putImageData(colored, 0, 0); return this; }, _colorize: function (pixels, gradient) { for (var i = 0, len = pixels.length, j; i < len; i += 4) { j = pixels[i + 3] * 4; if (j) { pixels[i] = gradient[j]; pixels[i + 1] = gradient[j + 1]; pixels[i + 2] = gradient[j + 2]; } } } };