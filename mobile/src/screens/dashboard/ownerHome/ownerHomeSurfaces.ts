/** Quiet category tints beneath the primary blue financial summary. */
export function ownerHomeSurfaces(dark: boolean) {
  return dark
    ? {
        clients: {
          background: '#152c2a',
          ink: '#ace3d6',
          divider: '#304b45',
          strong: '#76cbb6',
          soft: '#477d72',
          inset: '#1c3933',
        },
        attention: { background: '#30271b', ink: '#edc58b', divider: '#4e402d', inset: '#493720' },
        earnings: { background: '#272338', ink: '#d0c0f1', divider: '#433b58', inset: '#3c3353' },
        service: { background: '#232b36', ink: '#c1d0e3', divider: '#3c4758', inset: '#323e4d' },
      }
    : {
        clients: {
          background: '#f0f7f4',
          ink: '#205f53',
          divider: '#d5e3dc',
          strong: '#27816e',
          soft: '#a2ccbe',
          inset: '#e5f0ea',
        },
        attention: { background: '#fff9ef', ink: '#80541d', divider: '#f0e3cc', inset: '#f7ecd8' },
        earnings: { background: '#f2eff8', ink: '#665185', divider: '#e1d9ed', inset: '#e7dff2' },
        service: { background: '#f2f5f9', ink: '#43566e', divider: '#dce3ec', inset: '#e6edf5' },
      };
}
