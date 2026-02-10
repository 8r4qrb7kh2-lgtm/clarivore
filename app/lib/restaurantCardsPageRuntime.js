import { isManagerOrOwnerUser } from "./managerRestaurants.js";
import { filterRestaurantsByVisibility } from "./restaurantVisibility.js";

export function renderRestaurantCardsPage(options = {}) {
  const { state, renderTopbar, root, div, esc, send, getWeeksAgoInfo } = options;

  renderTopbar();
  if (!root) return;

  root.innerHTML =
    '<h1 style="text-align:center">Restaurants</h1><div class="cards" id="grid"></div>';
  const grid = document.getElementById("grid");
  if (!grid) return;

  const showAll = isManagerOrOwnerUser(state.user);
  const filteredRestaurants = filterRestaurantsByVisibility(state.restaurants || [], {
    user: state.user || null,
  });

  filteredRestaurants.forEach((restaurant) => {
    const card = div(`<div class="card">
    <img src="${esc(restaurant.menuImage || "")}" alt="">
    <div class="pad">
      <div style="font-weight:800;margin-bottom:6px">${esc(restaurant.name || "Restaurant")}</div>
      ${(() => {
        if (!restaurant.lastConfirmed) {
          return '<div class="note">Last confirmed by staff: —</div>';
        }
        const info = getWeeksAgoInfo(restaurant.lastConfirmed, showAll);
        if (!info) return "";
        return `<div class="note" style="color: ${info.color}">Last confirmed by staff: ${esc(info.text)}</div>`;
      })()}
      <div style="margin-top:10px"><button class="btn btnPrimary">View menu & allergens</button></div>
    </div></div>`);

    const button = card.querySelector(".btn");
    if (button) {
      button.onclick = () => send({ type: "openRestaurant", slug: restaurant.slug });
    }

    grid.appendChild(card);
  });
}
