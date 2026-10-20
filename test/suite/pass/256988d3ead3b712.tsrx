function Test() {
				return <section>
					@if (ready) { <div /> } @else { <span /> }
				</section>;
			}