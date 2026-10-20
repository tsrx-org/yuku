export default function App() @{
	const n = 1;
	<div>
		@switch (n) {
			@case 1: { <s>one</s> }
			@default: { <u>o</u> }
		}
	</div>
}
