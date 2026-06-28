import WidgetKit
import SwiftUI

@main
struct AuTexaWidgetBundle: WidgetBundle {
    var body: some Widget {
        // Home Screen widgets (Small / Medium / Large).
        AuTexaWidget()
        // Live Activity / Dynamic Island (iOS 16.1+). The bundle compiles
        // on iOS 17.0 (widget deployment target) so this is always available;
        // the guard keeps the intent explicit and future-proof.
        if #available(iOS 16.1, *) {
            AutexaLiveActivityWidget()
        }
    }
}
