from machine import Pin
import time

# --- Pin mapping ---
PINS = {
    "tea":        4,
    "milk":       5,
    "sugar":      13,
    "boba":       14,
    "grass_jelly": 16,
    "stirrer":    17,
}

# --- Flow rates (ml per second) ---
# These are placeholder values — calibrate with real pumps later
FLOW_RATES = {
    "tea":        1.5,
    "milk":       1.5,
    "sugar":      0.8,
    "boba":       2.0,   # volume of pearls per second
    "grass_jelly": 1.2,
    "stirrer":    None,  # stirrer runs for a fixed duration, not by volume
}

# Initialize all pins LOW on startup
for name, pin_num in PINS.items():
    Pin(pin_num, Pin.OUT).off()


def dispense(ingredient, amount):
    """
    Activate a pin for the duration needed to dispense `amount` ml.
    For stirrer, `amount` is treated directly as seconds.
    """
    if ingredient not in PINS:
        print(f"Unknown ingredient: {ingredient}")
        return

    pin = Pin(PINS[ingredient], Pin.OUT)

    if ingredient == "stirrer":
        duration = amount  # amount = seconds to stir
    else:
        rate = FLOW_RATES[ingredient]
        duration = amount / rate

    print(f"Dispensing {ingredient}: {amount} {'sec' if ingredient == 'stirrer' else 'ml'} ({duration:.1f}s)")
    pin.on()
    time.sleep(duration)
    pin.off()
    print(f"  Done.")


def make_boba(recipe):
    """
    Execute a recipe dict sequentially.
    recipe = { ingredient: amount_in_ml, ..., "stirrer": seconds }
    """
    print("--- Starting boba sequence ---")
    for ingredient, amount in recipe.items():
        dispense(ingredient, amount)
        time.sleep(0.3)  # small gap between steps
    print("--- Done! Enjoy your boba ---")


def repl():
    """
    Simple REPL to customize and run a recipe interactively.
    Type ingredient and amount, or 'run' to execute, 'quit' to exit.
    """
    print("Boba REPL — available ingredients:", list(PINS.keys()))
    print("Commands: '<ingredient> <amount>'  |  'run'  |  'reset'  |  'quit'")

    recipe = {}

    while True:
        line = input("> ").strip().lower()

        if line == "quit":
            break

        elif line == "run":
            if not recipe:
                print("Recipe is empty.")
            else:
                print("Current recipe:", recipe)
                make_boba(recipe)

        elif line == "reset":
            recipe = {}
            print("Recipe cleared.")

        elif line == "show":
            print("Current recipe:", recipe)

        else:
            parts = line.split()
            if len(parts) != 2:
                print("Usage: <ingredient> <amount>")
                continue
            ingredient, amount = parts[0], parts[1]
            if ingredient not in PINS:
                print(f"Unknown ingredient. Choose from: {list(PINS.keys())}")
                continue
            try:
                recipe[ingredient] = float(amount)
                print(f"  Set {ingredient} = {amount}")
            except ValueError:
                print("Amount must be a number.")


# --- Default recipe (used when not in REPL mode) ---
default_recipe = {
    "tea":        200,   # ml
    "milk":       100,   # ml
    "sugar":      15,    # ml
    "boba":       50,    # ml
    "stirrer":    10,    # seconds
}

if __name__ == "__main__":
    # Comment out one of these depending on what you want:
    make_boba(default_recipe)   # just run the default recipe
    # repl()                    # interactive mode
