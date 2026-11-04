# Board Tracker

Keeps track of kitchen boards: which colours you've got, which customers they're for,
what's been ordered and when it's due. Everyone on the team sees the same list, live, on
any phone or PC.

**Live app:** https://paulsgamedevhub.github.io/board-tracker/

## How it works

- **Main screen:** each board colour with how many you've got. Red means short (order more),
  teal means covered, amber means spare boards or a delivery due.
- **Tap a board** to see its customers. Spare is always at the top. Add customers with how many
  boards they need (fixed once added), count boards in with **Got**, mark **Ordered?** with how many
  and the expected delivery date. When that date arrives it asks **Delivered?** and moves the
  boards into Got.
- Spare boards automatically cover customers who are short; **Take from spare** moves them across.
- **To order** panel: everything short, with a button to copy the order list for your supplier.
- **Edit colour / Add board colour** to change the list of colours.

## Data and sign-in

- Data is stored in Firebase (Google), project `board-tracker-fdaed`, in London (europe-west2).
- Everyone signs in once per device with the team login (created in the Firebase console).
- Firestore security rules only allow that team login to read or write.
- The Firebase settings in `index.html` are designed to be public; they are not a password.

## Files

- `index.html` – the app
- `style.css` – the PaulsGameDevHub house style
