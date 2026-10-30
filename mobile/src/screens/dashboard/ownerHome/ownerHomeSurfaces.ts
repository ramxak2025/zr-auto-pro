/** Quiet, role-specific surfaces beneath the primary blue financial chart. */
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
          background: '#eaf5f1',
          ink: '#205f53',
          divider: '#ccdfd7',
          strong: '#27816e',
          soft: '#a2ccbe',
          inset: '#dbece5',
        },
        attention: { background: '#fff6e8', ink: '#80541d', divider: '#edddc3', inset: '#f4e6ce' },
        earnings: { background: '#f2eff8', ink: '#665185', divider: '#e1d9ed', inset: '#e7dff2' },
        service: { background: '#edf1f6', ink: '#43566e', divider: '#d6dee8', inset: '#dde5ef' },
      };
}
