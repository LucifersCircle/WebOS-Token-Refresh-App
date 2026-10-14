/* ES5 transport for TVs without fetch or the URLSearchParams object overload. */
(function (global) {
    'use strict';

    function encodeForm(fields) {
        return Object.keys(fields).map(function (key) {
            return encodeURIComponent(key) + '=' + encodeURIComponent(fields[key]);
        }).join('&');
    }

    function postFormJSON(url, fields, timeoutMs) {
        return new Promise(function (resolve, reject) {
            var xhr, timer, settled = false;
            function finish(error, response) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (error) reject(error);
                else resolve(response);
            }
            try {
                xhr = new global.XMLHttpRequest();
                xhr.open('POST', url, true);
                xhr.setRequestHeader('Accept', 'application/json');
                xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
                xhr.onreadystatechange = function () {
                    if (xhr.readyState !== 4 || settled) return;
                    if (!xhr.status) { finish(new Error('Unable to connect to the renewal server.')); return; }
                    try {
                        finish(null, { status: xhr.status, ok: xhr.status >= 200 && xhr.status < 300,
                            data: JSON.parse(xhr.responseText) });
                    } catch (_) { finish(new Error('The renewal server returned invalid JSON.')); }
                };
                xhr.onerror = function () { finish(new Error('Unable to connect to the renewal server.')); };
                xhr.onabort = function () { finish(new Error('The server request was cancelled.')); };
                timer = setTimeout(function () {
                    finish(new Error('The server request timed out.'));
                    xhr.abort();
                }, timeoutMs || 10000);
                xhr.send(encodeForm(fields));
            } catch (error) { finish(error); }
        });
    }

    global.encodeForm = encodeForm;
    global.postFormJSON = postFormJSON;
}(window));
