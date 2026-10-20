export function FeatureCard() @{
				<div>{<h1>before @if (ok) { <div>1</div> } @else { <div>2</div> } after</h1>}</div>
			}