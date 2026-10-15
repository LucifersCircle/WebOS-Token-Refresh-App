/* Native alerts through the TV's paired remote interface; no root privileges. */
(function (global) {
    'use strict';
    var KEY_NAME = 'com.pirate.refresh.nativeAlerts.clientKey';

    function pairingError(message) {
        var error = new Error(message);
        error.pairingFailed = true;
        return error;
    }

    function NativeAlertClient(options) {
        options = options || {};
        this.WebSocket = options.WebSocket || global.WebSocket;
        this.onState = options.onState || function () {};
        try { this.storage = options.storage || global.localStorage; } catch (_) {}
        this.key = null;
        try { this.key = this.storage.getItem(KEY_NAME); } catch (_) {}
        this.socket = null;
        this.connecting = null;
        this.ready = false;
        this.pending = {};
        this.expiredCreates = {};
        this.sequence = 0;
    }

    NativeAlertClient.prototype.saveKey = function (key) {
        this.key = key;
        try {
            if (key) this.storage.setItem(KEY_NAME, key);
            else this.storage.removeItem(KEY_NAME);
        } catch (_) { this.onState('storage-unavailable'); }
    };

    NativeAlertClient.prototype.connect = function () {
        var self = this;
        if (self.ready) return Promise.resolve();
        if (self.connecting) return self.connecting;
        var connection = new Promise(function (resolve, reject) {
            var socket, timer, registrationId, usingSavedKey = !!self.key, settled = false;
            function fail(error) {
                clearTimeout(timer);
                if (self.socket !== socket) return;
                self.ready = false;
                self.connecting = null;
                self.socket = null;
                self.expiredCreates = {};
                Object.keys(self.pending).forEach(function (id) {
                    var request = self.pending[id];
                    clearTimeout(request.timer);
                    delete self.pending[id];
                    request.reject(error);
                });
                if (!settled) { settled = true; reject(error); }
                if (socket) socket.close();
            }
            function deadline(delay, message, pairing) {
                clearTimeout(timer);
                timer = setTimeout(function () { fail(pairing ? pairingError(message) : new Error(message)); }, delay);
            }
            function register() {
                registrationId = 'register-' + (++self.sequence);
                var payload;
                if (usingSavedKey) {
                    self.onState('connecting');
                    payload = { 'client-key': self.key };
                    deadline(5000, 'Saved pairing could not be checked.');
                } else {
                    self.onState('pairing');
                    payload = {
                        pairingType: 'PROMPT',
                        manifest: {
                            manifestVersion: 1,
                            appVersion: '1.0.5',
                            appId: 'com.pirate.refresh',
                            vendorId: 'LucifersCircle',
                            localizedAppNames: { '': 'Auto Token Refresh' },
                            localizedVendorNames: { '': 'Lucifers Circle' },
                            permissions: ['WRITE_NOTIFICATION_TOAST']
                        }
                    };
                    deadline(60000, 'TV pairing timed out.', true);
                }
                socket.send(JSON.stringify({ type: 'register', id: registrationId, payload: payload }));
            }
            try {
                socket = new self.WebSocket('ws://127.0.0.1:3000');
                self.socket = socket;
                deadline(5000, 'The TV remote service did not respond.');
                socket.onopen = function () {
                    if (self.socket !== socket) return;
                    try { register(); } catch (_) { fail(new Error('Could not start TV pairing.')); }
                };
                socket.onmessage = function (event) {
                    if (self.socket !== socket) return;
                    var message;
                    try { message = JSON.parse(event.data); } catch (_) { return; }
                    if (!message || typeof message !== 'object') return;
                    if (message.id === registrationId && !settled) {
                        if (message.type === 'registered') {
                            var key = message.payload && message.payload['client-key'];
                            if (typeof key !== 'string' || !key) {
                                self.saveKey(null);
                                return fail(pairingError('TV pairing failed to return a key.'));
                            }
                            self.saveKey(key);
                            clearTimeout(timer);
                            self.ready = true;
                            settled = true;
                            self.onState('connected');
                            resolve();
                        } else if (message.type === 'error') {
                            // Only an explicit authentication rejection invalidates a saved key.
                            if (usingSavedKey && /^(401|403)\b/.test(message.error || '')) {
                                usingSavedKey = false;
                                self.saveKey(null);
                                try { register(); } catch (_) { fail(new Error('Could not restart TV pairing.')); }
                            } else if (usingSavedKey) fail(new Error('Saved TV approval could not be checked.'));
                            else fail(pairingError('TV pairing was declined or could not be completed.'));
                        }
                        return;
                    }
                    if (self.expiredCreates[message.id]) {
                        delete self.expiredCreates[message.id];
                        if (message.payload && message.payload.alertId) {
                            self.closeAlert(message.payload.alertId).catch(function () {});
                        }
                        return;
                    }
                    var request = self.pending[message.id];
                    if (!request || (message.type !== 'response' && message.type !== 'error')) return;
                    clearTimeout(request.timer);
                    delete self.pending[message.id];
                    if (message.type === 'error' || !message.payload || message.payload.returnValue !== true) {
                        request.reject(new Error('The TV rejected the native alert request.'));
                    } else request.resolve(message.payload);
                };
                socket.onerror = function () { fail(new Error('Cannot connect to the TV remote service.')); };
                socket.onclose = function () { fail(new Error('The TV remote connection closed.')); };
            } catch (_) {
                // Constructor failures happen before self.socket can be assigned.
                clearTimeout(timer);
                settled = true;
                reject(new Error('The TV remote service is unavailable.'));
            }
        });
        self.connecting = connection;
        connection.then(function () {
            if (self.connecting === connection) self.connecting = null;
        }, function () {
            if (self.connecting === connection) self.connecting = null;
        });
        return connection;
    };

    NativeAlertClient.prototype.request = function (method, payload) {
        var self = this;
        return self.connect().then(function () {
            return new Promise(function (resolve, reject) {
                var id = 'request-' + (++self.sequence);
                var timer = setTimeout(function () {
                    delete self.pending[id];
                    if (method === 'createAlert') self.expiredCreates[id] = true;
                    reject(new Error('The native alert request timed out.'));
                }, 5000);
                self.pending[id] = { resolve: resolve, reject: reject, timer: timer };
                try {
                    self.socket.send(JSON.stringify({ type: 'request', id: id,
                        uri: 'ssap://system.notifications/' + method, payload: payload }));
                } catch (_) {
                    clearTimeout(timer);
                    delete self.pending[id];
                    reject(new Error('The TV remote connection is unavailable.'));
                }
            });
        });
    };

    NativeAlertClient.prototype.closeAlert = function (alertId) {
        // Cleanup must never open a new pairing dialog.
        if (!this.ready) return Promise.resolve();
        return this.request('closeAlert', { alertId: alertId });
    };

    global.NativeAlertClient = NativeAlertClient;
}(window));
