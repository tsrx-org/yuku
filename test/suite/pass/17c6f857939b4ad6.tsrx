export function FeatureCard() @{
				<ElementA prop={<h1>@if (ok) { <div>1</div> } @else { <div>2</div> }</h1>} />
			}