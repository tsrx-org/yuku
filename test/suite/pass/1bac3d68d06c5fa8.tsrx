function Retained(enabled) {
					const content = @{
						if (enabled) {
							<aside />
						}

						<main />
					};

					return content;
				}

				function Nested(enabled) {
					return <section>
						@{
							if (enabled) {
								<aside />
							}

							<main />
						}
					</section>;
				}