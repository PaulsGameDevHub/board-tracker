# Board Tracker

Keeps track of kitchen boards: which colours you've got, which customers they're for,
what's been ordered and when it's due. Everyone on the team sees the same list, live, on
any phone or PC.

**Live apps:**
- Board Tracker: https://paulsgamedevhub.github.io/board-tracker/
- Stock Orders: https://paulsgamedevhub.github.io/board-tracker/orders.html

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

## Stock Orders (orders.html)

- Request anything that needs ordering, marked Running low or Out of stock.
- Mark as ordered with an expected delivery date; it flags when the date arrives.
- Delivered moves it to the order history, which clears itself after 30 days.
- Both pages share the same login and show orders waiting in the To order panel.

## Files

- `index.html` – Board Tracker
- `orders.html` – Stock Orders
- `app.js` – shared code for both pages (Firebase, sign-in, boards, orders)
- `app.css` – styles for both pages
- `style.css` – the PaulsGameDevHub house style
