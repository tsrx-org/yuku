export function UserBadge({ user }: UserBadgeProps): JSX.Element {
			const initials = user.name.slice(0, 2).toUpperCase();

			<button title={user.name}>{initials}</button>
		}