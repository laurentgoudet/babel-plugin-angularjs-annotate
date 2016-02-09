module.exports = {
  name: "IIFEs and Reference-Following",
  tests: [
    {
      name: "IIFE-jumping (primarily for compile-to-JS langs)",
      input: function(){
        angular.module("MyMod").directive("foo", function($a, $b) {
            $uibModal.open({
                resolve: {
                    collection: (function(_this) {
                        return function($c) {
                        };
                    })(this),
                },
            });
        });
      },
      expected: function(){
        angular.module("MyMod").directive("foo", ["$a", "$b", function($a, $b) {
            $uibModal.open({
                resolve: {
                    collection: (function(_this) {
                        return ["$c", function($c) {
                        }];
                    })(this),
                },
            });
        }]);
      }
    },
    {
      name: "Explicit annotation on IIFE",
      // Maybe unnecessary in the world of Babel?
      input: function(){
        var x = /*@ngInject*/ (function() {
            return function($a) {
            };
        })();
      },
      expected: function(){
        var x = /*@ngInject*/ (function() {
            return ["$a", function($a) {
            }];
        })();
      }
    },
    {
      name: "advanced IIFE-jumping (with reference support)",
      input: function(){
        var myCtrl10 = (function() {
            "use strict";
            // the return statement can appear anywhere on the functions topmost level,
            // including before the myCtrl function definition
            return myCtrl;
            function myCtrl($scope) {
                foo;
            }
            post;
        })();
        angular.module("MyMod").controller("MyCtrl", myCtrl10);
      },
      expected: function(){
        var myCtrl10 = (function() {
            "use strict";
            // the return statement can appear anywhere on the functions topmost level,
            // including before the myCtrl function definition
            myCtrl.$inject = ["$scope"];
            return myCtrl;
            function myCtrl($scope) {
                foo;
            }
            post;
        })();
        angular.module("MyMod").controller("MyCtrl", myCtrl10);
      }
    },
    {
      name: "advanced IIFE-jumping (with reference support) and premature return statement",
      input: function(){
        var myCtrl11 = (function() {
            pre;
            var myCtrl = function($scope) {
                foo;
            };
            mid;
            // the return statement can appear anywhere on the functions topmost level,
            // including before the myCtrl function definition
            return myCtrl;
            post;
        })();
        angular.module("MyMod").controller("MyCtrl", myCtrl11);
      },
      expected: function(){
        var myCtrl11 = (function() {
            pre;
            var myCtrl = function($scope) {
                foo;
            };
            myCtrl.$inject = ["$scope"];
            mid;
            // the return statement can appear anywhere on the functions topmost level,
            // including before the myCtrl function definition
            return myCtrl;
            post;
        })();
        angular.module("MyMod").controller("MyCtrl", myCtrl11);
      }
    },
    {
      name: "proper scope analysis including shadowing",
      input: function(){
        "use strict";
        function MyCtrl1(a, b) {
        }
        if (true) {
            let MyCtrl1 = function(c) {
            };
            angular.module("MyMod").directive("foo", MyCtrl1);
        }
        angular.module("MyMod").controller("bar", MyCtrl1);
      },
      expected: function(){
        "use strict";

        MyCtrl1.$inject = ["a", "b"];
        function MyCtrl1(a, b) {
        }
        if (true) {
            let MyCtrl1 = function(c) {
            };
            MyCtrl1.$inject = ["c"];
            angular.module("MyMod").directive("foo", MyCtrl1);
        }
        angular.module("MyMod").controller("bar", MyCtrl1);
      }
    },
    {
      name: "explicit annotation on reference flows back to definition",
      input: function(){
        function MyCtrl2(z) {
        }
        funcall(/*@ngInject*/ MyCtrl2);
      },
      expected: function(){
        MyCtrl2.$inject = ["z"];

        function MyCtrl2(z) {
        }
        funcall(/*@ngInject*/ MyCtrl2);
      }
    },
    {
      name: "hoisted function should chain onto module",
      input: function(){
        angular.module("MyMod").directive("foo", MyDirective);

        function MyDirective($stateProvider) {
            $stateProvider.state('astate', {
                resolve: {
                    yoyo: function(ma) {
                    },
                }
            });
        }
      },
      expected: function(){
        MyDirective.$inject = ["$stateProvider"];

        angular.module("MyMod").directive("foo", MyDirective);

        function MyDirective($stateProvider) {
            $stateProvider.state('astate', {
                resolve: {
                    yoyo: ["ma", function(ma) {
                    }],
                }
            });
        }
      }
    }
  ]
}
