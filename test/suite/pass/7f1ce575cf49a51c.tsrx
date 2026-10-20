const something = @{
					const theme = <style>.dark {}</style>;
					<>
						<style apply={theme}>.card {}</style>
						<div class="card" />
					</>
				};