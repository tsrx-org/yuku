class Plain { method() {} field = 1; accessor stored = 1; }
			const Expression = class { method() {} };
			@dec class Decorated { @member method() {} field = 1; }