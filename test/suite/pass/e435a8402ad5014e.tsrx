function App(ready, items, value) @{
					<>
						<style>.a {}</style>
						@if (ready) {
							<><style>.b {}</style><div /></>
						} @else {
							<><style>.c {}</style><span /></>
						}
					</>
				}
				function List(items) @{
					@for (const item of items) {
						<><style>.d {}</style><li>{item}</li></>
					}
				}
				function Pick(value) @{
					@switch (value) { @case 1: { <><style>.e {}</style><div /></> } @default: { <span /> } }
				}
				function Safe() @{
					@try {
						<><style>.f {}</style><div /></>
					} @catch (error) {
						<><style>.g {}</style><span /></>
					}
				}
				function Nested() @{
					<div>@{
						<><style>.h {}</style><span /></>
					}</div>
				}