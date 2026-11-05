// Pay is shown in US dollars. The API sends plain numbers (dollars, two decimals).

const FORMAT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export const money = (value) => FORMAT.format(Number(value) || 0);
