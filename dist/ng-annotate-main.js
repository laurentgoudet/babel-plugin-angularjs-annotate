// ng-annotate-main.js
// MIT licensed, see LICENSE file
// Copyright (c) 2013-2016 Olov Lassus <olov.lassus@gmail.com>

"use strict";

var is = require("simple-is");
var assert = require("assert");
var ngInject = require("./nginject");
var scopeTools = require("./scopetools");
// const optionalAngularDashboardFramework = require("./optionals/angular-dashboard-framework");
var t = require('babel-types');

var chainedRouteProvider = 1;
var chainedUrlRouterProvider = 2;
var chainedStateProvider = 3;
var chainedRegular = 4;

function match(path, ctx, explicitOnly) {
    var node = path.node;
    var isMethodCall = t.isCallExpression(node) && t.isMemberExpression(node.callee) && node.callee.computed === false;

    if (isMethodCall && ngInject.inspectComment(path, ctx)) {
        return false;
    }

    if (explicitOnly) {
        return false;
    }

    // matchInjectorInvoke must happen before matchRegular
    // to prevent false positive ($injector.invoke() outside module)
    // matchProvide must happen before matchRegular
    // to prevent regular from matching it as a short-form
    var matchMethodCalls = isMethodCall && (matchInjectorInvoke(path) || matchProvide(path, ctx) || matchRegular(path, ctx) || matchNgRoute(path) || matchMaterialShowModalOpen(path) || matchNgUi(path) || matchHttpProvider(path) || matchControllerProvider(path));

    return matchMethodCalls;
}

function matchMaterialShowModalOpen(path) {
    // $mdDialog.show({.. controller: fn, resolve: {f: function($scope) {}, ..}});
    // $mdToast.show({.. controller: fn, resolve: {f: function($scope) {}, ..}});
    // $mdBottomSheet.show({.. controller: fn, resolve: {f: function($scope) {}, ..}});
    // $modal.open({.. controller: fn, resolve: {f: function($scope) {}, ..}});

    // we already know that node is a (non-computed) method call
    var node = path.node;
    var callee = node.callee;
    var obj = callee.object; // identifier or expression
    var method = callee.property; // identifier
    var args = node.arguments;

    if (t.isIdentifier(obj) && (is.someof(obj.name, ["$modal", "$uibModal"]) && method.name === "open" || is.someof(obj.name, ["$mdDialog", "$mdToast", "$mdBottomSheet"]) && method.name === "show") && args.length === 1 && t.isObjectExpression(args[0])) {
        var _args = path.get("arguments");
        var props = _args[0].get("properties");
        var res = [matchProp("controller", props)];
        res.push.apply(res, matchResolve(props));
        return res.filter(Boolean);
    }
    return false;
}

function matchDirectiveReturnObject(path) {
    var node = path.node;

    // only matches inside directives
    // return { .. controller: function($scope, $timeout), ...}

    return limit("directive", t.isReturnStatement(node) && node.argument && t.isObjectExpression(node.argument) && matchProp("controller", path.get && path.get("argument.properties") || node.argument.properties));
}

function limit(name, path) {
    var node = path && path.node || path;

    if (node && !path.$limitToMethodName) {
        path.$limitToMethodName = name;
        // node.$limitToMethodName = name;
    }
    return path;
}

function matchProviderGet(path) {
    // only matches inside providers
    // (this|self|that).$get = function($scope, $timeout)
    // { ... $get: function($scope, $timeout), ...}
    var node = path.node;
    var memberExpr = void 0;
    var self = void 0;
    var yes = limit("provider", t.isAssignmentExpression(node) && t.isMemberExpression(memberExpr = node.left) && memberExpr.property.name === "$get" && (t.isThisExpression(self = memberExpr.object) || t.isIdentifier(self) && is.someof(self.name, ["self", "that"])) && path.get("right") || t.isObjectExpression(node) && matchProp("$get", path.get("properties")));

    return yes;
}

function matchNgRoute(path) {
    // $routeProvider.when("path", {
    //   ...
    //   controller: function($scope) {},
    //   resolve: {f: function($scope) {}, ..}
    // })

    // we already know that node is a (non-computed) method call
    var node = path.node;
    var callee = node.callee;
    var obj = callee.object; // identifier or expression
    if (!(obj.$chained === chainedRouteProvider || t.isIdentifier(obj) && obj.name === "$routeProvider")) {
        return false;
    }
    node.$chained = chainedRouteProvider;

    var method = callee.property; // identifier
    if (method.name !== "when") {
        return false;
    }

    var args = path.get("arguments");
    if (args.length !== 2) {
        return false;
    }
    var configArg = last(args);
    if (!t.isObjectExpression(configArg)) {
        return false;
    }

    var props = configArg.get("properties");
    var res = [matchProp("controller", props)];
    // {resolve: ..}
    res.push.apply(res, matchResolve(props));

    var filteredRes = res.filter(Boolean);
    return filteredRes.length === 0 ? false : filteredRes;
}

function matchNgUi(path) {
    // $stateProvider.state("myState", {
    //     ...
    //     controller: function($scope)
    //     controllerProvider: function($scope)
    //     templateProvider: function($scope)
    //     onEnter: function($scope)
    //     onExit: function($scope)
    // });
    // $stateProvider.state("myState", {... resolve: {f: function($scope) {}, ..} ..})
    // $stateProvider.state("myState", {... params: {params: {simple: function($scope) {}, inValue: { value: function($scope) {} }} ..})
    // $stateProvider.state("myState", {... views: {... somename: {... controller: fn, controllerProvider: fn, templateProvider: fn, resolve: {f: fn}}}})
    //
    // stateHelperProvider.setNestedState({ sameasregularstate, children: [sameasregularstate, ..]})
    // stateHelperProvider.setNestedState({ sameasregularstate, children: [sameasregularstate, ..]}, true)
    //
    // $urlRouterProvider.when(.., function($scope) {})
    //
    // $modal.open see matchMaterialShowModalOpen

    // we already know that node is a (non-computed) method call
    var node = path.node;
    var callee = node.callee;
    var obj = callee.object; // identifier or expression
    var method = callee.property; // identifier
    var args = path.get("arguments");

    // shortcut for $urlRouterProvider.when(.., function($scope) {})
    if (obj.$chained === chainedUrlRouterProvider || t.isIdentifier(obj) && obj.name === "$urlRouterProvider") {
        node.$chained = chainedUrlRouterProvider;

        if (method.name === "when" && args.length >= 1) {
            return last(args);
        }
        return false;
    }

    // everything below is for $stateProvider and stateHelperProvider alone
    if (!(obj.$chained === chainedStateProvider || t.isIdentifier(obj) && is.someof(obj.name, ["$stateProvider", "stateHelperProvider"]))) {
        return false;
    }
    node.$chained = chainedStateProvider;

    if (is.noneof(method.name, ["state", "setNestedState"])) {
        return false;
    }

    // $stateProvider.state({ ... }) and $stateProvider.state("name", { ... })
    // stateHelperProvider.setNestedState({ .. }) and stateHelperProvider.setNestedState({ .. }, true)
    if (!(args.length >= 1 && args.length <= 2)) {
        return false;
    }

    var configArg = method.name === "state" ? last(args) : args[0];

    var res = [];

    recursiveMatch(configArg);

    var filteredRes = res.filter(Boolean);
    return filteredRes.length === 0 ? false : filteredRes;

    function recursiveMatch(objectExpressionPath) {
        if (!objectExpressionPath || !t.isObjectExpression(objectExpressionPath)) {
            return false;
        }

        var properties = objectExpressionPath.get("properties");

        matchStateProps(properties, res);

        var childrenArrayExpression = matchProp("children", properties);
        var children = childrenArrayExpression && childrenArrayExpression.get("elements");

        if (!children) {
            return;
        }
        children.forEach(recursiveMatch);
    }

    function matchStateProps(props, res) {
        var simple = [matchProp("controller", props), matchProp("controllerProvider", props), matchProp("templateProvider", props), matchProp("onEnter", props), matchProp("onExit", props)];
        res.push.apply(res, simple);

        // {resolve: ..}
        res.push.apply(res, matchResolve(props));

        // {params: {simple: function($scope) {}, inValue: { value: function($scope) {} }}
        var a = matchProp("params", props);
        if (a && t.isObjectExpression(a)) {
            a.get("properties").forEach(function (prop) {
                var value = prop.get("value");
                if (t.isObjectExpression(value)) {
                    res.push(matchProp("value", value.get("properties")));
                } else {
                    res.push(value);
                }
            });
        }

        // {view: ...}
        var viewObject = matchProp("views", props);
        if (viewObject && t.isObjectExpression(viewObject)) {
            viewObject.get("properties").forEach(function (prop) {
                var value = prop.get("value");
                if (t.isObjectExpression(value)) {
                    var _props = value.get("properties");
                    res.push(matchProp("controller", _props));
                    res.push(matchProp("controllerProvider", _props));
                    res.push(matchProp("templateProvider", _props));
                    res.push.apply(res, matchResolve(_props));
                }
            });
        }
    }
}

function matchInjectorInvoke(path) {
    // $injector.invoke(function($compile) { ... });

    // we already know that node is a (non-computed) method call
    var node = path.node;
    var callee = node.callee;
    var obj = callee.object; // identifier or expression
    var method = callee.property; // identifier
    var args = void 0;

    return method.name === "invoke" && t.isIdentifier(obj) && obj.name === "$injector" && (args = path.get("arguments")).length >= 1 && args;
}

function matchHttpProvider(path) {
    // $httpProvider.interceptors.push(function($scope) {});
    // $httpProvider.responseInterceptors.push(function($scope) {});

    // we already know that node is a (non-computed) method call
    var node = path.node;
    var callee = node.callee;
    var obj = callee.object; // identifier or expression
    var method = callee.property; // identifier
    var args = void 0;

    return method.name === "push" && t.isMemberExpression(obj) && !obj.computed && obj.object.name === "$httpProvider" && is.someof(obj.property.name, ["interceptors", "responseInterceptors"]) && (args = path.get("arguments")).length >= 1 && args;
}

function matchControllerProvider(path) {
    // $controllerProvider.register("foo", function($scope) {});

    // we already know that node is a (non-computed) method call
    var node = path.node;
    var callee = node.callee;
    var obj = callee.object; // identifier or expression
    var method = callee.property; // identifier
    var args = void 0;

    var target = t.isIdentifier(obj) && obj.name === "$controllerProvider" && method.name === "register" && (args = path.get("arguments")).length === 2 && args[1];

    if (target) {
        target.node.$methodName = method.name;
    }
    return target;
}

function matchProvide(path, ctx) {
    // $provide.decorator("foo", function($scope) {});
    // $provide.service("foo", function($scope) {});
    // $provide.factory("foo", function($scope) {});
    // $provide.provider("foo", function($scope) {});

    // we already know that node is a (non-computed) method call
    var node = path.node;
    var callee = node.callee;
    var obj = callee.object; // identifier or expression
    var method = callee.property; // identifier
    var args = path.get("arguments");

    var target = t.isIdentifier(obj) && obj.name === "$provide" && is.someof(method.name, ["decorator", "service", "factory", "provider"]) && args.length === 2 && args[1];

    if (target) {
        target.node.$methodName = method.name;
        target.$methodName = method.name;

        if (ctx.rename) {
            // for eventual rename purposes
            return args;
        }
    }
    return target;
}

function matchRegular(path, ctx) {
    // we already know that node is a (non-computed) method call
    var node = path.node;
    var callee = node.callee;
    var obj = callee.object; // identifier or expression
    var method = callee.property; // identifier

    // short-cut implicit config special case:
    // angular.module("MyMod", function(a) {})
    if (obj.name === "angular" && method.name === "module") {
        var _args2 = path.get("arguments");
        if (_args2.length >= 2) {
            node.$chained = chainedRegular;
            return last(_args2);
        }
    }

    // hardcoded exception: foo.decorator is generally considered a short-form
    // declaration but $stateProvider.decorator is not. see https://github.com/olov/ng-annotate/issues/82
    if (obj.name === "$stateProvider" && method.name === "decorator") {
        return false;
    }

    var matchAngularModule = (obj.$chained === chainedRegular || isReDef(obj, ctx) || isLongDef(obj)) && is.someof(method.name, ["provider", "value", "constant", "bootstrap", "config", "factory", "directive", "filter", "run", "controller", "service", "animation", "invoke", "store", "decorator", "component"]);
    if (!matchAngularModule) {
        return false;
    }
    node.$chained = chainedRegular;

    if (is.someof(method.name, ["value", "constant", "bootstrap"])) {
        return false; // affects matchAngularModule because of chaining
    }

    var args = node.arguments;
    var argPaths = path.get("arguments");
    var target = is.someof(method.name, ["config", "run"]) ? args.length === 1 && argPaths[0] : args.length === 2 && t.isLiteral(args[0]) && is.string(args[0].value) && argPaths[1];

    if (method.name === "component") {
        target.node.$chained = chainedRegular;
        return matchComponent(target);
    }

    if (target) {
        target.node.$methodName = method.name;
    }

    if (ctx.rename && args.length === 2 && target) {
        // for eventual rename purposes
        var somethingNameLiteral = args[0];
        return [somethingNameLiteral, target];
    }
    return target;
}

// matches with default regexp
//   *.controller("MyCtrl", function($scope, $timeout) {});
//   *.*.controller("MyCtrl", function($scope, $timeout) {});
// matches with --regexp "^require(.*)$"
//   require("app-module").controller("MyCtrl", function($scope) {});
function isReDef(node, ctx) {
    return ctx.re.test(ctx.srcForRange(node));
}

// Long form: angular.module(*).controller("MyCtrl", function($scope, $timeout) {});
function isLongDef(node) {
    return node.callee && node.callee.object && node.callee.object.name === "angular" && node.callee.property && node.callee.property.name === "module";
}

function last(arr) {
    return arr[arr.length - 1];
}

function matchProp(name, props) {
    for (var i = 0; i < props.length; i++) {
        var propOrPath = props[i];
        var prop = propOrPath.node || propOrPath;

        if (t.isIdentifier(prop.key) && prop.key.name === name || t.isLiteral(prop.key) && prop.key.value === name) {
            return propOrPath.get && propOrPath.get("value") || prop.value; // FunctionExpression or ArrayExpression
        }
    }
    return null;
}

function matchResolve(props) {
    var resolveObject = matchProp("resolve", props);
    if (resolveObject && t.isObjectExpression(resolveObject)) {
        return resolveObject.get("properties").map(function (prop) {
            return prop.get("value");
        });
    }
    return [];
}

function matchComponent(path) {
    var chained = path.node.$chained;
    if (t.isIdentifier(path)) {
        path = followReference(path);
        if (t.isVariableDeclarator(path)) {
            path = path.get('init');
        }
    }
    if (t.isObjectExpression(path)) {
        path.node.chained = chained;
        var props = path.get("properties");

        var ctrl = matchProp("controller", props);
        var tmpl = matchProp("template", props);
        var tmplUrl = matchProp("templateUrl", props);

        var res = [];
        ctrl && res.push(ctrl);
        tmpl && res.push(tmpl);
        tmplUrl && res.push(tmplUrl);

        res.forEach(function (t) {
            return t.node.$chained = chained;
        });
        return res;
    } else {
        return false;
    }
}

function renamedString(ctx, originalString) {
    if (ctx.rename) {
        return ctx.rename.get(originalString) || originalString;
    }
    return originalString;
}

function insertArray(ctx, path) {
    if (!path.node) {
        console.warn("Not a path", path, path.loc.start, path.loc.end);
        return;
    }

    var toParam = path.node.params.map(function (param) {
        return param.name;
    });
    var elems = toParam.map(function (i) {
        return t.stringLiteral(i);
    });

    elems.push(path.node);

    path.replaceWith(t.expressionStatement(t.arrayExpression(elems)));
}

// TODO: Is this necessary?
function renameProviderDeclarationSite(ctx, literalNode, fragments) {
    fragments.push({
        start: literalNode.range[0] + 1,
        end: literalNode.range[1] - 1,
        str: renamedString(ctx, literalNode.value),
        loc: {
            start: {
                line: literalNode.loc.start.line,
                column: literalNode.loc.start.column + 1
            }, end: {
                line: literalNode.loc.end.line,
                column: literalNode.loc.end.column - 1
            }
        }
    });
}

function judgeSuspects(ctx) {
    var blocked = ctx.blocked;

    var suspects = makeUnique(ctx.suspects, 1);

    for (var n = 0; n < 42; n++) {
        // could be while(true), above is just a safety-net
        // in practice it will loop just a couple of times
        propagateModuleContextAndMethodName(suspects);
        if (!setChainedAndMethodNameThroughIifesAndReferences(suspects)) {
            break;
        }
    }

    // create final suspects by jumping, following, uniq'ing, blocking
    var finalSuspects = makeUnique(suspects.map(function (target) {
        var jumped = jumpOverIife(target);
        var jumpedAndFollowed = followReference(jumped) || jumped;

        if (target.$limitToMethodName && target.$limitToMethodName !== "*never*" && findOuterMethodName(target) !== target.$limitToMethodName) {
            return null;
        }

        if (blocked.indexOf(jumpedAndFollowed) >= 0) {
            return null;
        }

        return jumpedAndFollowed;
    }).filter(Boolean), 2);

    finalSuspects.forEach(function (path) {
        var target = path.node || path;
        if (target.$chained !== chainedRegular) {
            return;
        }

        if (isFunctionExpressionWithArgs(target) && !t.isVariableDeclarator(path.parent)) {
            insertArray(ctx, path);
        } else if (isGenericProviderName(target)) {
            // console.warn("Generic provider rename disabled");
            // renameProviderDeclarationSite(ctx, target, fragments);
        } else {
            // if it's not array or function-expression, then it's a candidate for foo.$inject = [..]
            judgeInjectArraySuspect(path, ctx);
        }
    });

    function propagateModuleContextAndMethodName(suspects) {
        suspects.forEach(function (path) {
            if (path.node.$chained !== chainedRegular && isInsideModuleContext(path)) {
                path.node.$chained = chainedRegular;
            }

            if (!path.node.$methodName) {
                var methodName = findOuterMethodName(path);
                if (methodName) {
                    path.node.$methodName = methodName;
                }
            }
        });
    }

    function findOuterMethodName(path) {
        for (; path && !path.node.$methodName; path = path.parentPath) {}
        return path ? path.node.$methodName : null;
    }

    function setChainedAndMethodNameThroughIifesAndReferences(suspects) {
        var modified = false;
        suspects.forEach(function (path) {
            var target = path.node;

            var jumped = jumpOverIife(path);
            var jumpedNode = jumped.node;
            if (jumpedNode !== target) {
                // we did skip an IIFE
                if (target.$chained === chainedRegular && jumpedNode.$chained !== chainedRegular) {
                    modified = true;
                    jumpedNode.$chained = chainedRegular;
                }
                if (target.$methodName && !jumpedNode.$methodName) {
                    modified = true;
                    jumpedNode.$methodName = target.$methodName;
                }
            }

            var jumpedAndFollowed = followReference(jumped) || jumped;
            if (jumpedAndFollowed.node !== jumped.node) {
                // we did follow a reference
                if (jumped.node.$chained === chainedRegular && jumpedAndFollowed.node.$chained !== chainedRegular) {
                    modified = true;
                    jumpedAndFollowed.node.$chained = chainedRegular;
                }
                if (jumped.node.$methodName && !jumpedAndFollowed.node.$methodName) {
                    modified = true;
                    jumpedAndFollowed.node.$methodName = jumped.node.$methodName;
                }
            }
        });
        return modified;
    }

    function isInsideModuleContext(path) {
        var $parent = path.parentPath;
        for (; $parent && $parent.node.$chained !== chainedRegular; $parent = $parent.parentPath) {}
        return Boolean($parent);
    }

    function makeUnique(suspects, val) {
        return suspects.filter(function (target) {
            if (target.$seen === val) {
                return false;
            }
            target.$seen = val;
            return true;
        });
    }
}

function followReference(path) {
    var node = path.node;
    if (!scopeTools.isReference(path)) {
        return null;
    }

    var binding = path.scope.getBinding(node.name);
    if (!binding) {
        return null;
    }

    var kind = binding.kind;
    var bound = binding.path;

    if (is.someof(kind, ["const", "let", "var"])) {

        if (t.isVariableDeclaration(bound)) {
            var declarations = bound.get('declarations');
            assert(declarations.length === 1);
            return declarations[0];
        }

        assert(t.isVariableDeclarator(bound) || t.isClassDeclaration(bound));
        // {type: "VariableDeclarator", id: {type: "Identifier", name: "foo"}, init: ..}
        return bound;
    } else if (kind === "hoisted") {
        assert(t.isFunctionDeclaration(bound) || isFunctionExpressionOrArrow(bound));
        // FunctionDeclaration is the common case, i.e.
        // function foo(a, b) {}

        // FunctionExpression is only applicable for cases similar to
        // var f = function asdf(a,b) { mymod.controller("asdf", asdf) };
        return bound;
    }

    // other kinds should not be handled ("param", "caught")

    return null;
}

function judgeInjectArraySuspect(path, ctx) {
    var node = path.node;

    if (t.isVariableDeclaration(node)) {
        // suspect can only be a VariableDeclaration (statement) in case of
        // explicitly marked via /*@ngInject*/, not via references because
        // references follow to VariableDeclarator (child)

        // /*@ngInject*/ var foo = function($scope) {} and

        if (node.declarations.length !== 1) {
            // more than one declarator => exit
            return;
        }

        // one declarator => jump over declaration into declarator
        // rest of code will treat it as any (referenced) declarator
        path = path.get("declarations")[0];
        node = path.node;
    }

    // onode is a top-level node (inside function block), later verified
    // node is inner match, descent in multiple steps
    var opath = null;
    var declaratorName = null;
    if (t.isVariableDeclarator(node)) {
        opath = path.parentPath;

        declaratorName = node.id.name;
        node = node.init; // var foo = ___;
        path = path.get("init");
    } else {
        opath = path;
    }

    if (t.isExportDeclaration(opath.parent)) {
        opath = opath.parentPath;
    }

    // suspect must be inside of a block or at the top-level (i.e. inside of node.$parent.body[])
    if (!node || !opath.parent || !t.isProgram(opath.parent) && !t.isBlockStatement(opath.parent)) {
        return;
    }

    path = jumpOverIife(path);
    node = path.node;

    if (t.isClass(node)) {
        declaratorName = node.id.name;
        node = getConstructor(node);
    }

    if (isFunctionExpressionWithArgs(node) || t.isClassMethod(node)) {
        // var x = 1, y = function(a,b) {}, z;

        if (node.id && node.id.name !== declaratorName) {
            console.warn("Declarator name different", declaratorName);
        }

        assert(declaratorName);
        addInjectArrayAfterPath(node.params, opath, declaratorName);
    } else if (isFunctionDeclarationWithArgs(node)) {
        // /*@ngInject*/ function foo($scope) {}
        addInjectArrayBeforePath(node.params, path, node.id.name);
    } else if (t.isExpressionStatement(node) && t.isAssignmentExpression(node.expression) && isFunctionExpressionWithArgs(node.expression.right) && !path.get("expression.right").$seen) {
        // /*@ngInject*/ foo.bar[0] = function($scope) {}
        var inject = buildInjectExpression(node.expression.right.params, t.cloneDeep(node.expression.left));
        path.insertAfter(inject);
    } else if (path = followReference(path)) {
        // node was a reference and followed node now is either a
        // FunctionDeclaration or a VariableDeclarator
        // => recurse

        !path.$seen && judgeInjectArraySuspect(path, ctx);
    }

    function buildInjectExpression(params, name) {
        var left = t.isNode(name) ? name : t.identifier(name);
        var paramStrings = params.map(function (param) {
            return t.stringLiteral(param.name);
        });
        var arr = t.arrayExpression(paramStrings); // ["$scope"]
        var member = t.memberExpression(left, t.identifier("$inject")); // foo.$inject =
        return t.expressionStatement(t.assignmentExpression("=", member, arr));
    }

    function addInjectArrayBeforePath(params, path, name) {
        var binding = path.scope.getBinding(name);
        if (binding && binding.kind === 'hoisted') {
            // let block = t.isProgram(binding.scope.block) ? binding.scope.block : binding.scope.block.body;
            // block.body.unshift(buildInjectExpression(params, name));
            var expr = buildInjectExpression(params, name);
            var block = binding.scope.getBlockParent().path;
            if (block.isFunction()) {
                block = block.get("body");
            }
            block.unshiftContainer("body", [expr]);
        } else {
            path.insertBefore(buildInjectExpression(params, name));
        }
    }

    function addInjectArrayAfterPath(params, path, name) {
        var trailingComments = void 0;
        if (path.node.trailingComments) {
            trailingComments = path.node.trailingComments;
            path.node.trailingComments = [];
        }
        var newNode = path.insertAfter(buildInjectExpression(params, name));
        newNode.trailingComments = trailingComments;
    }
}

function jumpOverIife(path) {
    var node = path.node;
    if (!path.node) {
        console.warn("Not a path");
    }

    if (!(t.isCallExpression(node) && isFunctionExpressionOrArrow(node.callee))) {
        return path;
    }

    var outerbody = path.get("callee.body.body");
    for (var i = 0; i < outerbody.length; i++) {
        var statement = outerbody[i];
        if (t.isReturnStatement(statement)) {
            return statement.get("argument");
        }
    }

    return path;
}

function addModuleContextDependentSuspect(target, ctx) {
    ctx.suspects.push(target);
}

function addModuleContextIndependentSuspect(target, ctx) {
    target.node.$chained = chainedRegular;
    ctx.suspects.push(target);
}

function isFunctionExpressionOrArrow(node) {
    return t.isFunctionExpression(node) || t.isArrowFunctionExpression(node);
}

function isFunctionExpressionWithArgs(node) {
    return isFunctionExpressionOrArrow(node) && node.params.length >= 1;
}
function isFunctionDeclarationWithArgs(node) {
    return t.isFunctionDeclaration(node) && node.params.length >= 1;
}
function isGenericProviderName(node) {
    return t.isLiteral(node) && is.string(node.value);
}

function getConstructor(node) {
    var body = node.body.body;
    for (var i = 0; i < body.length; i++) {
        var _node = body[i];
        if (_node.kind === 'constructor') {
            return _node;
        }
    }
}

module.exports.match = match;
module.exports.addModuleContextDependentSuspect = addModuleContextDependentSuspect;
module.exports.addModuleContextIndependentSuspect = addModuleContextIndependentSuspect;
module.exports.judgeSuspects = judgeSuspects;
module.exports.matchDirectiveReturnObject = matchDirectiveReturnObject;
module.exports.matchProviderGet = matchProviderGet;