"use client";

import { Badge, Button, Input, Textarea } from "../../../components/ui";

function statusTone(status) {
  const normalized = String(status || "");
  if (
    normalized === "acknowledged" ||
    normalized === "question_answered"
  ) {
    return "success";
  }
  if (
    normalized === "rejected_by_server" ||
    normalized === "rejected_by_kitchen"
  ) {
    return "danger";
  }
  if (
    normalized === "awaiting_server_approval" ||
    normalized === "queued_for_kitchen" ||
    normalized === "with_kitchen" ||
    normalized === "awaiting_user_response"
  ) {
    return "warn";
  }
  return "neutral";
}

export function RestaurantOrderFlowPanel({ orderFlow, user }) {
  return (
    <section className="rounded-2xl border border-[rgba(124,156,255,0.25)] bg-[rgba(11,14,34,0.82)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-lg font-semibold text-[#eef3ff]">Order notice</h2>
        <Badge tone={statusTone(orderFlow.activeOrder?.status)}>{orderFlow.statusLabel}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-xl border border-[rgba(124,156,255,0.2)] bg-[rgba(17,22,48,0.8)] p-3">
          <h3 className="m-0 text-sm font-semibold text-[#dce5ff]">Selected dishes</h3>
          <div className="mt-2 space-y-2">
            {orderFlow.selectedDishNames.map((dishName) => (
              <div
                key={dishName}
                className="flex items-center justify-between rounded-lg border border-[rgba(124,156,255,0.24)] bg-[rgba(7,10,28,0.8)] px-2 py-1.5"
              >
                <span className="text-sm text-[#eff3ff]">{dishName}</span>
                <Button
                  size="compact"
                  variant="link"
                  className="!text-[#ffb2b2]"
                  onClick={() => orderFlow.removeDish(dishName)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
          {!orderFlow.selectedDishNames.length ? (
            <p className="m-0 mt-2 text-xs text-[#9ba7cc]">
              Add dishes from the viewer to build a notice.
            </p>
          ) : null}
        </div>

        <form
          className="space-y-2 rounded-xl border border-[rgba(124,156,255,0.2)] bg-[rgba(17,22,48,0.8)] p-3"
          onSubmit={async (event) => {
            event.preventDefault();
            await orderFlow.submitNotice();
          }}
        >
          <label className="block text-sm text-[#bdd0ff]">
            Diner name
            <Input
              value={orderFlow.formState.customerName}
              placeholder={user?.user_metadata?.first_name || "Your name"}
              onChange={(event) =>
                orderFlow.updateFormField("customerName", event.target.value)
              }
            />
          </label>

          <label className="block text-sm text-[#bdd0ff]">
            Dining mode
            <select
              value={orderFlow.formState.diningMode}
              onChange={(event) =>
                orderFlow.updateFormField("diningMode", event.target.value)
              }
              className="mt-1 h-[44px] w-full rounded-xl border border-[#2a3261] bg-[rgba(17,22,48,0.95)] px-3 text-[#dce5ff]"
            >
              <option value="dine-in">Dine-in</option>
              <option value="delivery">Delivery / pickup</option>
            </select>
          </label>

          <label className="block text-sm text-[#bdd0ff]">
            Server code (optional)
            <Input
              value={orderFlow.formState.serverCode}
              placeholder="#### + table"
              onChange={(event) =>
                orderFlow.updateFormField("serverCode", event.target.value)
              }
            />
          </label>

          <label className="block text-sm text-[#bdd0ff]">
            Additional notes
            <Textarea
              rows={3}
              value={orderFlow.formState.notes}
              onChange={(event) =>
                orderFlow.updateFormField("notes", event.target.value)
              }
            />
          </label>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="submit"
              tone="primary"
              loading={orderFlow.isSubmitting}
              disabled={!orderFlow.selectedDishNames.length}
            >
              Submit notice
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => orderFlow.refreshStatus()}
            >
              Refresh status
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={orderFlow.reset}
            >
              Reset
            </Button>
          </div>

          {orderFlow.submitError ? (
            <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-2 py-1 text-xs text-[#ffd0d0]">
              {orderFlow.submitError}
            </p>
          ) : null}
          {orderFlow.statusError ? (
            <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-2 py-1 text-xs text-[#ffd0d0]">
              {orderFlow.statusError}
            </p>
          ) : null}
        </form>
      </div>
    </section>
  );
}

export default RestaurantOrderFlowPanel;
