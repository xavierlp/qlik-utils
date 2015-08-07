var https = require('https');
var crypto = require('crypto');
var url = require('url');
var fs = require('fs');
var basic = require('basic-auth');
var uuid = require('node-uuid');
var Q = require('q');

/**
 * Two parameters mode
 *  If a is undefined, return b else a
 * Three parameters mode
 *  If a is undefined, return c else b
 *
 * @example
 * var myHost = ifnotundef(options.host, options.hostname);
 *
 * @example
 * var myHost = ifnotundef(options.host, options.hostname, 'localhost');
 *
 * @param {*} a
 * @param {*} b
 * @param {*=} c
 * @returns {*}
 */
function ifnotundef(a, b, c) {
    return (typeof c == 'undefined') ? ((typeof a != 'undefined' && a != null) ? a : b) : ((typeof a != 'undefined' && a != null) ? b : c);
}

/**
 * Generates a random Xrf key of a given size within a set of given chars
 *
 * @example
 * var xrf = generateXrfkey(8);
 *
 * @param {integer=} [size=16]
 * @param {string=} [chars=abcdefghijklmnopqrstuwxyzABCDEFGHIJKLMNOPQRSTUWXYZ0123456789]
 * @returns {string}
 */
function generateXrfkey(size, chars) {
    size = size || 16;
    chars = chars || 'abcdefghijklmnopqrstuwxyzABCDEFGHIJKLMNOPQRSTUWXYZ0123456789';

    var rnd = crypto.randomBytes(size), value = new Array(size), len = chars.length;

    for (var i = 0; i < size; i++) {
        value[i] = chars[rnd[i] % len]
    }

    return value.join('');
}

/**
 * Makes a request on a Qlik Sense API endpoint defined in the options object, posting the params object
 *
 * @example
 * request({
 *      'UserId': 'qlikservice',
 *      'UserDirectory': '2008R2-0',
 *      'Attributes': []
 * }, {
 *      restUri: 'https://10.76.224.72:4243/qps/ticket',
 *      pfx: pfx,
 *      passPhrase: ''
 * }).then(function(retVal) {
 *      console.log(retVal);
 * });
 *
 * @param {Object} params the parameters to post to the API endpoint
 * @param {Object} options the options to connect to the API endpoint
 * @returns {Promise}
 */
function request(params, options) {

    var xrfkey = generateXrfkey();
    var restUri = url.parse(options.restUri);

    var headers = {
        'X-Qlik-Xrfkey': xrfkey,
        'Content-Type': 'application/json'
    };

    if(typeof options.UserDirectory != 'undefined' || typeof options.UserId != 'undefined')
        headers['X-Qlik-User'] = 'UserDirectory= ' + ifnotundef(options.UserDirectory, '.') + '; UserId= ' + ifnotundef(options.UserId, 'qlikservice');

    if(typeof options.session != 'undefined')
        headers['Cookie'] = options.session;

    var settings = {
        protocol: restUri.protocol,
        host: restUri.hostname,
        port: restUri.port,
        path: restUri.pathname + '?' + ifnotundef(restUri.query, restUri.query + '&', '') + 'xrfkey=' + xrfkey,
        method: ifnotundef(options.method, 'POST'),
        headers: headers,
        pfx: ifnotundef(options.pfx, null),
        passphrase: ifnotundef(options.passPhrase, null),
        rejectUnauthorized: false,
        agent: false
    };

    var requestDef = Q.defer();

    if(settings.protocol != 'https:') requestDef.reject('https is needed to make API call');
    else {

        var apireq = https.request(settings, function (apires) {

            var body = "";
            apires.on('data', function (d) {
                body += d.toString()
            });

            apires.on('end', function (d) {
                try {
                    requestDef.resolve(JSON.parse(body));
                } catch(err) {
                    requestDef.reject({err: err, body: body});
                }
            });

        });

        if(typeof options.timeout != 'undefined')
            apireq.on('socket', function (socket) {
                socket.setTimeout(parseInt(options.timeout));
                socket.on('timeout', function() {
                    apireq.abort();
                });
            });

        if(params) {
            apireq.write(JSON.stringify(params));
        }

        apireq.end();

        apireq.on('error', function (e) {
            requestDef.reject(e);
        });

    }

    return requestDef.promise;

};

/**
 * Generates a ticket on Qlik Sense QRS Api
 *
 * @example
 * getTicket({
 *      'UserId': 'qlikservice',
 *      'UserDirectory': '2008R2-0',
 *      'Attributes': []
 * }, {
 *      restUri: 'https://10.76.224.72:4243',
 *      pfx: pfx,
 *      passPhrase: ''
 * }).then(function(retVal) {
 *      console.log(retVal);
 * });
 *
 * @param {Object} params the ticket parameters
 * @param {Object} options the options to connect to the ticket API endpoint
 * @returns {Promise}
 */
function getTicket(params, options) {

    var restUri = url.parse(options.restUri);

    var ticketOptions = {
        restUri: restUri.protocol + '//' + restUri.host + '/qps/ticket',
        method: 'POST',
        pfx: options.pfx,
        passPhrase: options.passPhrase
    };

    return request(params, ticketOptions);

}

/**
 * Opens a session on the Qlik Sense Hub with the given ticket and returns the session cookie
 *
 * @example
 * openSession({
 *      UserDirectory: '2008R2-0',
 *      UserId: 'qlikservice',
 *      Attributes: [],
 *      Ticket: 'QzSPXzBmJKjhucPF',
 *      TargetUri: null
 * }, url.parse('https://localhost/hub')).then(function(retVal) {
 *      console.log(retVal);
 * });
 *
 * @param {Object} ticket the generated ticket
 * @param {Object} options parsed url of the Qlik Sense Hub
 * @returns {Promise}
 */
function openSession(ticket, options) {

    var requestDef = Q.defer();

    var settings = {
        host: options.hostname,
        port: options.port,
        path: options.pathname + '?' + ifnotundef(options.query, options.query + '&', '') + 'qlikTicket=' + ticket.Ticket,
        method: 'GET',
        rejectUnauthorized: false,
        agent: false
    };

    var prot = (options.protocol == 'https:') ? https : http;

    var req = prot.request(settings, function (response) {
        response.on('data', function (d) {
            var cookies = response.headers['set-cookie'];
            requestDef.resolve(cookies[0]);
        });
    });

    req.on('error', function(e) {
        requestDef.reject(e);
    });

    req.end();

    return requestDef.promise;

}


/**
 * Adds the given ip address to the websocket whitelist of the given virtual proxy
 *
 * @example
 * readFile('./client.pfx').then(function(certif) {
 *
 *      return utils.addToWhiteList('10.76.224.72', {
 *          restUri: 'https://10.76.224.72:4242',
 *          pfx: certif,
 *          passPhrase: '',
 *          UserId: 'qlikservice',
 *          UserDirectory: '2008R2-0'
 *      });
 *
 * }).then(function(ret) {
 *      console.log(ret);
 * }, function(ret) {
 *      console.log(ret);
 * });
 *
 * @param  {string} ip the ip to add
 * @param  {Object} options the endpoint to add the ip to
 * @returns {Promise}
 */
function addToWhiteList(ip, options) {

    var restUri = url.parse(options.restUri);

    return request(null, {

        restUri: restUri.protocol + '//' + restUri.host + '/qrs/proxyservice/local',
        method: 'GET',
        pfx: options.pfx,
        passPhrase: options.passPhrase,
        UserId: options.UserId,
        UserDirectory: options.UserDirectory,
        timeout: options.timeout

    }).then(function(settings) {

        var vpsettings = settings.settings.virtualProxies[0];

        return request(null, {
            restUri: restUri.protocol + '//' + restUri.host + '/qrs/virtualproxyconfig/' + vpsettings.id,
            method: 'GET',
            pfx: options.pfx,
            passPhrase: options.passPhrase,
            UserId: options.UserId,
            UserDirectory: options.UserDirectory,
            timeout: options.timeout

        })

    }).then(function(settings) {

        if(settings.websocketCrossOriginWhiteList.indexOf(ip) == -1) {

            settings.websocketCrossOriginWhiteList.push(ip);

            var currDate = new Date();
            var oldDate = new Date(settings.modifiedDate);
            var newDate;

            if (currDate > oldDate) {
                newDate = currDate;
            } else {
                newDate = oldDate;
                newDate.setSeconds(newDate.getSeconds() + 1);
            }

            settings.modifiedDate = newDate.toISOString();

            return request(settings, {
                restUri: restUri.protocol + '//' + restUri.host + '/qrs/virtualproxyconfig/' + settings.id,
                method: 'PUT',
                pfx: options.pfx,
                passPhrase: options.passPhrase,
                UserId: options.UserId,
                UserDirectory: options.UserDirectory,
                timeout: options.timeout

            });

        } else {
            return 'already in whitelist!'
        }

    })

}


/**
 * Simple basic auth middleware for use with Express 4.x.
 *
 * @example
 * app.use('/api-requiring-auth', utils.basicAuth([{user: 'username', pass: 'password'}]));
 *
 * @param   {Object}   username list of usernames & passwords
 * @returns {function} Express 4 middleware requiring the given credentials
 */
function basicAuth(users) {
    return function(req, res, next) {
        var user = basic(req);

        if(
            !user || users.filter(function(item) {
                return item.user == user.name && item.pass == user.pass;
            }).length == 0
        ) {
            res.set('WWW-Authenticate', 'Basic realm=Authorization Required');
            return res.send(401);
        }

        req.authUser = user.name;
        next();
    };
};


/**
 * Task class
 */
function task() {

    var _this = this;
    var listenDef;

    // Private methods

    var changeStatus = function(status, val) {

        _this.status = status;
        _this.modifiedDate = new Date();
        _this.val = val;

        var oldListenDef = listenDef;

        if(_this.status == 'waiting' || _this.status == 'running') {
            listenDef = Q.defer();
            _this.listen = listenDef.promise;
        }

        if(typeof oldListenDef != 'undefined') {
            oldListenDef.resolve(_this);
        }

    };

    // constructor

    _this.guid = uuid.v1();
    changeStatus('waiting');

    // Public methods

    this.start = function() {
        _this.startedDate = new Date();
        this.running();
    };

    this.running = function(val) {
        changeStatus('running', val);
    };

    this.done = function(val) {
        changeStatus('done', val);
    };

    this.failed = function(val) {
        changeStatus('failed', val);
    };

}

task.all = function(tasks) {

    var tasksListeners = [], keys = [];
    for (var key in tasks) {
        if (tasks.hasOwnProperty(key)) {
            keys.push(key);
            tasksListeners.push(tasks[key].listen);
        }
    }

    return Q.all(tasksListeners).then(function(ret) {
        var retVal = {};
        ret.forEach(function(item, index) {
            retVal[keys[index]] = item;
        })
        return retVal;
    });
}


/**
 * Equivalent to setTimeout but returns a promise instead
 * @param timeout the timeout in ms
 * @returns {Promise}
 */
function setTimeout2Promise(timeout) {

    var timeoutDef = Q.defer();

    setTimeout(function() {
        timeoutDef.resolve();
    }, timeout);

    return timeoutDef.promise;

}


module.exports = {
    ifnotundef: ifnotundef,
    request: request,
    getTicket: getTicket,
    openSession: openSession,
    addToWhiteList: addToWhiteList,
    basicAuth: basicAuth,
    task: task,
    setTimeout2Promise: setTimeout2Promise
}
