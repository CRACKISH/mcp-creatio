import pkg from '../package.json';

export const NAME: string =
	(
		pkg as {
			name?: string;
		}
	).name || 'creatio-mcp';
export const VERSION: string =
	(
		pkg as {
			version?: string;
		}
	).version || '0.0.0';
