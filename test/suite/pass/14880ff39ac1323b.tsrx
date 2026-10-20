function App({ ok, c }) @{
				const v = @switch (c) { @case 1: { <h1><a />
					@if (ok) { <li>x</li> }
				</h1> } };
				<div>{v}</div>
			}