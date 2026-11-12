// Helpers create descriptions. Only the aim returned by tick is executed.
const bot = (() => {
    const isArray = Array.isArray;
    const keys = Object.keys;
    return Object.freeze({
        scan(options = {}) {
            if (options === null || typeof options !== 'object' || isArray(options))
                throw new TypeError('scan expects an options object');
            for (const key of keys(options)) {
                if (key !== 'speed' && key !== 'direction')
                    throw new TypeError('Unknown scan option');
            }
            return {
                __proto__: null,
                kind: 'scan',
                speed: options.speed === undefined ? 0.5 : options.speed,
                direction: options.direction === undefined ? 'clockwise' : options.direction
            };
        },
        aimAt(target) {
            return { __proto__: null, kind: 'at', target };
        },
        holdAim() {
            return { __proto__: null, kind: 'hold' };
        }
    });
})();
