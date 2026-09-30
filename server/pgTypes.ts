import { types } from "pg";

// A date column holds a calendar day. pg would turn it into a Date at local
// midnight, which can shift the day when it is turned back into text; keep
// the YYYY-MM-DD string instead.
types.setTypeParser(types.builtins.DATE, (value) => value);

// numeric arrives as text so nothing is lost in transit; prices, quantities
// and weights are JavaScript numbers everywhere else in the app.
types.setTypeParser(types.builtins.NUMERIC, (value) => Number(value));
