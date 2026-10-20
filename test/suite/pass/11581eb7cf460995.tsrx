import type * as estree from 'estree';

declare module 'estree' {
	export interface Decorator extends estree.BaseNode {
		type: 'Decorator';
		expression: estree.Expression;
	}
	interface PropertyDefinition {
		decorators: estree.Decorator[];
	}
	interface MethodDefinition {
		decorators: estree.Decorator[];
	}
	interface BaseClass {
		decorators: estree.Decorator[];
	}
}